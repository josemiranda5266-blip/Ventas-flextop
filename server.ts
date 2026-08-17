import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import crypto from "crypto";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

dotenv.config();

const app = express();
const PORT = 3000;

// Initialize Firebase Admin SDK using settings from firebase-applet-config.json
const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
let firebaseConfig: any = {};
if (fs.existsSync(firebaseConfigPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
  } catch (err) {
    console.error("Error parsing firebase-applet-config.json:", err);
  }
}

const projectId = firebaseConfig.projectId || process.env.GCP_PROJECT || "gen-lang-client-0084774429";
const adminApp = admin.initializeApp({
  projectId: projectId
});

// Get database reference using database ID
export const dbAdmin = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId || "ai-studio-posargentina-44d7a43c-9ffd-4af2-b56d-0be623e6be8b");

// Body parser
app.use(express.json());

// API Routes FIRST
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    appName: "POS Argentina"
  });
});

// --- ARCA AFIP FISCAL INTEGRATION SERVICE ---
// Real endpoints for ARCA WSAA and WSFEV1
const getArcaService = () => {
  if (process.env.ARCA_MOCK === 'true' && process.env.NODE_ENV !== 'production') {
      return null;
  }
  
  if (!process.env.ARCA_CUIT || !process.env.ARCA_CERTIFICATE_BASE64 || !process.env.ARCA_PRIVATE_KEY_BASE64) {
      throw new Error('ARCA_NOT_CONFIGURED');
  }

  return {
    auth: new ArcaAuth({
      cuit: process.env.ARCA_CUIT,
      environment: process.env.ARCA_ENVIRONMENT === 'production' ? 'production' : 'homologation',
      certificateBase64: process.env.ARCA_CERTIFICATE_BASE64,
      privateKeyBase64: process.env.ARCA_PRIVATE_KEY_BASE64,
      pointOfSale: process.env.ARCA_POINT_OF_SALE || '00001',
    }),
    wsfe: new ArcaWsfe({
        cuit: process.env.ARCA_CUIT,
        environment: process.env.ARCA_ENVIRONMENT === 'production' ? 'production' : 'homologation',
        certificateBase64: process.env.ARCA_CERTIFICATE_BASE64,
        privateKeyBase64: process.env.ARCA_PRIVATE_KEY_BASE64,
        pointOfSale: process.env.ARCA_POINT_OF_SALE || '00001',
    })
  };
};

app.post("/api/arca/authorize", async (req, res) => {
  try {
      const { saleId, total, items, customer } = req.body;
      const arcaService = getArcaService();
      
      if (!arcaService) {
          return res.status(500).json({ success: false, message: "Servicio ARCA no disponible." });
      }

      // 1. Authenticate (WSAA)
      const { token, sign } = await arcaService.auth.getTokenAndSign();

      // 2. Authorize (WSFEv1)
      const result = await arcaService.wsfe.solicitarCAE(token, sign, {
          saleId, total, items, customer
      });

      return res.json({ success: true, data: result });
  } catch (error: any) {
      console.error("Error en ARCA:", error);
      return res.status(500).json({ success: false, message: error.message });
  }
});

// --- SECURE ATOMIC SALES FINALIZATION ---
// This handles full server-side verification, stock deduction, role authorization, cash session status, and customer credit limits within a single Firestore transaction.
app.post("/api/sales/finalize", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Token de autorización faltante o inválido." });
  }
  const idToken = authHeader.split(" ")[1];
  let decodedToken;
  try {
    decodedToken = await getAuth(adminApp).verifyIdToken(idToken);
  } catch (error) {
    return res.status(401).json({ success: false, message: "Sesión inválida o expirada.", error: String(error) });
  }
  const uid = decodedToken.uid;

  const {
    businessId,
    branchId,
    activeSessionId,
    cart, // Array of { product: { id }, qty, customPrice, discountPercent }
    customerId,
    generalDiscount, // percentage
    generalSurcharge, // percentage
    payments, // Array of { method, amount }
    mpOrderReference
  } = req.body;

  if (!businessId || !branchId || !activeSessionId || !cart || !Array.isArray(cart) || cart.length === 0 || !payments || !Array.isArray(payments)) {
    return res.status(400).json({ success: false, message: "Datos de solicitud incompletos o inválidos." });
  }

  // Calculate if there is any Mercado Pago payment
  let mpAmount = 0;
  for (const pay of payments) {
    if (pay.method === 'MERCADO_PAGO') {
      mpAmount += pay.amount;
    }
  }

  // Mercado Pago Verification: strictly required if payment method includes Mercado Pago
  if (mpAmount > 0) {
    if (!mpOrderReference) {
      return res.status(400).json({ success: false, message: "Referencia de orden de Mercado Pago requerida para procesar el cobro por QR." });
    }
    
    // Server-side check: verify directly with Mercado Pago API using server token
    const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    if (!token) {
      return res.status(400).json({ 
        success: false, 
        message: "Mercado Pago no está configurado en el servidor (Falta Token). Por favor, contacte al administrador." 
      });
    }

    try {
      const url = `https://api.mercadopago.com/v1/payments/search?external_reference=${mpOrderReference}`;
      const mpResponse = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (!mpResponse.ok) {
        return res.status(400).json({ success: false, message: "Error al comunicarse con la API de Mercado Pago para validar el cobro." });
      }
      const mpData = await mpResponse.json();
      let approved = false;
      let paymentId = "";
      if (mpData.results && mpData.results.length > 0) {
        const latestPayment = mpData.results.sort((a: any, b: any) => 
          new Date(b.date_created).getTime() - new Date(a.date_created).getTime()
        )[0];
        if (latestPayment.status.toUpperCase() === 'APPROVED') {
          approved = true;
          paymentId = latestPayment.id;
        }
      }

      if (!approved) {
        return res.status(400).json({ 
          success: false, 
          message: "Operación denegada: El pago de Mercado Pago aún no ha sido aprobado por el cliente en su aplicación." 
        });
      }
    } catch (err) {
      return res.status(500).json({ success: false, message: "Error de red al validar el pago de Mercado Pago.", error: String(err) });
    }
  }

  try {
    // Run atomic Firestore Transaction
    await dbAdmin.runTransaction(async (transaction) => {
      // 1. Validate User Profile
      const userProfileRef = dbAdmin.collection(`businesses/${businessId}/users`).doc(uid);
      const userProfileSnap = await transaction.get(userProfileRef);
      if (!userProfileSnap.exists) {
        throw new Error("No se encontró el perfil de usuario para este comercio.");
      }
      const userProfile = userProfileSnap.data()!;
      if (!['ADMINISTRADOR', 'ENCARGADO', 'CAJERO', 'VENDEDOR'].includes(userProfile.role)) {
        throw new Error("Su rol de usuario no tiene autorización para emitir ventas.");
      }

      // 2. Validate Cash Session Status
      const sessionRef = dbAdmin.collection(`businesses/${businessId}/branches/${branchId}/cash_sessions`).doc(activeSessionId);
      const sessionSnap = await transaction.get(sessionRef);
      if (!sessionSnap.exists) {
        throw new Error("La sesión de caja especificada no existe.");
      }
      const sessionData = sessionSnap.data()!;
      if (sessionData.status !== "OPEN") {
        throw new Error("La sesión de caja se encuentra CERRADA. Debe abrir la caja antes de vender.");
      }

      // 3. Validate and build products logic, check stocks
      let subtotalVal = 0;
      const itemsToSave: any[] = [];
      const stockUpdates: { ref: any; nextStock: number; currentStock: number; name: string; id: string }[] = [];

      for (const item of cart) {
        const productRef = dbAdmin.collection(`businesses/${businessId}/products`).doc(item.product.id);
        const productSnap = await transaction.get(productRef);
        if (!productSnap.exists) {
          throw new Error(`El producto con ID ${item.product.id} no existe.`);
        }
        const productData = productSnap.data()!;

        // Price Validation (Source of truth is DB)
        const basePrice = productData.salePrice;
        let price = basePrice;
        if (item.customPrice !== undefined) {
          // Custom price modification is strictly verified: only ADMINISTRADOR or ENCARGADO can modify it
          if (item.customPrice !== basePrice && !['ADMINISTRADOR', 'ENCARGADO'].includes(userProfile.role)) {
            throw new Error(`Permiso denegado: No posee autorización de rol para modificar el precio del producto ${productData.name}.`);
          }
          price = item.customPrice;
        }

        const discPercent = item.discountPercent || 0;
        const itemSubtotal = (price - (price * discPercent) / 100) * item.qty;
        subtotalVal += itemSubtotal;

        // Atomic Stock deduction check
        if (productData.stock < item.qty) {
          throw new Error(`¡OPERACIÓN CANCELADA! Stock insuficiente para el producto ${productData.name}. Disponible: ${productData.stock}, Requerido: ${item.qty}`);
        }

        itemsToSave.push({
          productId: item.product.id,
          name: productData.name,
          qty: item.qty,
          unitPrice: price,
          taxRate: productData.taxRate || 21,
          subtotal: itemSubtotal
        });

        stockUpdates.push({
          ref: productRef,
          nextStock: productData.stock - item.qty,
          currentStock: productData.stock,
          name: productData.name,
          id: item.product.id
        });
      }

      // Calculate discounts and surcharges
      const discVal = (subtotalVal * (generalDiscount || 0)) / 100;
      const surVal = (subtotalVal * (generalSurcharge || 0)) / 100;
      const totalVal = subtotalVal + surVal - discVal;

      // Calculate taxes (IVA sum)
      let taxTotalVal = 0;
      for (const item of itemsToSave) {
        const net = item.subtotal / (1 + item.taxRate / 100);
        const tax = item.subtotal - net;
        taxTotalVal += tax;
      }

      // 4. Verify Payment Amounts match calculated total
      let efAmount = 0;
      let ccAmount = 0;
      let totalPaid = 0;
      for (const pay of payments) {
        totalPaid += pay.amount;
        if (pay.method === 'EFECTIVO') efAmount += pay.amount;
        if (pay.method === 'CUENTA_CORRIENTE') ccAmount += pay.amount;
      }

      if (Math.abs(totalPaid - totalVal) > 0.1) {
        throw new Error(`El total pagado ($${totalPaid}) no coincide con el total de la venta calculado por el servidor ($${totalVal}).`);
      }

      // 5. Customer Balance check if Cuenta Corriente
      let customerData: any = null;
      let customerRef: any = null;
      if (customerId) {
        customerRef = dbAdmin.collection(`businesses/${businessId}/customers`).doc(customerId);
        const customerSnap = (await transaction.get(customerRef)) as any;
        if (!customerSnap.exists) {
          throw new Error("El cliente asignado no existe.");
        }
        customerData = customerSnap.data()!;
        if (customerData.status !== "ACTIVE") {
          throw new Error("El cliente asignado está INACTIVO.");
        }

        if (ccAmount > 0) {
          const currentBalance = customerData.balance || 0;
          const creditLimit = customerData.creditLimit || 0;
          if (currentBalance + ccAmount > creditLimit) {
            throw new Error(`Límite de crédito superado para el cliente ${customerData.name}. Saldo: $${currentBalance}, Monto: $${ccAmount}, Límite: $${creditLimit}`);
          }
        }
      } else if (ccAmount > 0) {
        throw new Error("Debe asignar un cliente registrado para vender a Cuenta Corriente (Al Fiado).");
      }

      // --- ALL VALIDATIONS PASSED: EXECUTE WRITES ---
      const saleId = mpOrderReference || `SALE_${Math.random().toString(36).substring(4).toUpperCase()}`;
      const saleRef = dbAdmin.collection(`businesses/${businessId}/sales`).doc(saleId);

      const saleData = {
        id: saleId,
        branchId,
        registerId: 'REG_MAIN_01',
        sessionId: activeSessionId,
        userId: uid,
        userName: userProfile.name || 'Cajero',
        customerId: customerId || null,
        customerName: customerData ? customerData.name : null,
        subtotal: subtotalVal,
        discount: discVal,
        surcharge: surVal,
        taxTotal: taxTotalVal,
        total: totalVal,
        paymentMethod: ccAmount > 0 ? 'CUENTA_CORRIENTE' : payments.length === 1 ? payments[0].method : 'MIXTO',
        status: 'COMPLETED',
        isFiscal: false,
        createdAt: new Date().toISOString()
      };

      // Write Sale
      transaction.set(saleRef, saleData);

      // Write Items
      for (const item of itemsToSave) {
        const itemRef = dbAdmin.collection(`businesses/${businessId}/sales/${saleId}/items`).doc();
        transaction.set(itemRef, item);
      }

      // Update Stock and create Stock Movement logs
      for (const update of stockUpdates) {
        transaction.update(update.ref, { stock: update.nextStock });
        const movementRef = dbAdmin.collection(`businesses/${businessId}/stock_movements`).doc();
        transaction.set(movementRef, {
          productId: update.id,
          productName: update.name,
          type: 'VENTA',
          qtyPrevious: update.currentStock,
          qtyChange: - (update.currentStock - update.nextStock),
          qtyAfter: update.nextStock,
          reason: `Venta POS #${saleId}`,
          userId: uid,
          userName: userProfile.name || 'Cajero',
          createdAt: new Date().toISOString()
        });
      }

      // Write Payments
      for (const p of payments) {
        const paymentRef = dbAdmin.collection(`businesses/${businessId}/sales/${saleId}/payments`).doc();
        transaction.set(paymentRef, {
          saleId,
          method: p.method,
          amount: p.amount,
          status: 'APPROVED',
          createdAt: new Date().toISOString()
        });
      }

      // Update Cashier expectedCash if cash paid
      if (efAmount > 0) {
        const nextExpectedCash = (sessionData.expectedCash || 0) + efAmount;
        transaction.update(sessionRef, { expectedCash: nextExpectedCash });
      }

      // Update Customer Cuenta Corriente balance if credit utilized
      if (ccAmount > 0 && customerRef) {
        const nextBalance = (customerData.balance || 0) + ccAmount;
        transaction.update(customerRef, { balance: nextBalance });

        // Write Cuenta Corriente log
        const ccLogRef = dbAdmin.collection(`businesses/${businessId}/cc_payment_logs`).doc();
        transaction.set(ccLogRef, {
          customerId,
          customerName: customerData.name,
          amount: ccAmount,
          type: 'CREDITO_DEUDA',
          details: `Compra a crédito POS #${saleId}`,
          createdAt: new Date().toISOString()
        });
      }

      // Write security/audit logs
      const auditLogRef = dbAdmin.collection(`businesses/${businessId}/audit_logs`).doc();
      transaction.set(auditLogRef, {
        userId: uid,
        userEmail: decodedToken.email || '',
        action: "VENTA_POS_SECURE",
        details: `Venta segura procesada #${saleId}. Total: $${totalVal}. Medio: ${ccAmount > 0 ? 'CC' : 'Efectivo/Mixto'}`,
        createdAt: new Date().toISOString()
      });
    });

    return res.json({ success: true, message: "Venta registrada exitosamente en base de datos segura de forma atómica." });
  } catch (error: any) {
    console.error("Error en transacción server-side:", error);
    return res.status(500).json({ success: false, message: error.message || "Error al procesar la venta de forma atómica en el servidor." });
  }
});

// Helper to fetch secrets securely
async function getProviderSecrets(businessId: string, provider: string) {
    const secretDoc = await dbAdmin.collection(`businesses/${businessId}/secrets`).doc(provider).get();
    if (!secretDoc.exists) throw new Error('PROVIDER_NOT_CONFIGURED');
    return secretDoc.data();
}

app.get("/api/payments/mercadopago/oauth/start", async (req, res) => {
    // 1. Get businessId from auth session
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ success: false, message: "Unauthorized" });
    const decodedToken = await getAuth(adminApp).verifyIdToken(authHeader.split(" ")[1]);
    const businessId = decodedToken.businessId; // Assumes businessId is in custom claims
    if (!businessId) return res.status(400).json({ success: false, message: "No businessId associated with user" });

    // 2. Generate secure state: {businessId}_{random}
    const state = `${businessId}_${crypto.randomBytes(16).toString('hex')}`;
    
    // 3. Store state
    await dbAdmin.collection(`businesses/${businessId}/secrets`).doc("mp_oauth_state").set({
        state,
        createdAt: new Date().toISOString()
    });

    const clientId = process.env.MERCADO_PAGO_CLIENT_ID;
    const redirectUri = `${req.protocol}://${req.get('host')}/api/payments/mercadopago/oauth/callback`;
    const authUrl = `https://auth.mercadopago.com.ar/authorization?client_id=${clientId}&response_type=code&platform_id=mp&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    
    res.redirect(authUrl);
});

app.get("/api/payments/mercadopago/oauth/callback", async (req, res) => {
    const { code, state: providedState } = req.query;
    
    // 1. Recover businessId from state: {businessId}_{random}
    const [businessId, ...rest] = (providedState as string).split('_');
    if (!businessId) return res.status(403).json({ success: false, message: "Invalid state" });

    // 2. Verify state
    const stateDoc = await dbAdmin.collection(`businesses/${businessId}/secrets`).doc("mp_oauth_state").get();
    if (!stateDoc.exists || stateDoc.data()?.state !== providedState) {
        return res.status(403).json({ success: false, message: "Invalid state or CSRF attack." });
    }

    // 3. Exchange code for token
    const tokenResponse = await fetch('https://api.mercadopago.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: process.env.MERCADO_PAGO_CLIENT_ID,
            client_secret: process.env.MERCADO_PAGO_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: `${req.protocol}://${req.get('host')}/api/payments/mercadopago/oauth/callback`
        })
    });

    const tokenData = await tokenResponse.json();

    // 4. Store tokens securely
    await dbAdmin.collection(`businesses/${businessId}/secrets`).doc("mercado_pago").set({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
        updatedAt: new Date().toISOString()
    });

    res.json({ success: true, message: "Cuenta vinculada exitosamente." });
});

app.post("/api/mercadopago/create-qr", async (req, res) => {
  const { saleId, amount, items } = req.body;
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;

  if (!token) {
    return res.status(400).json({
      success: false,
      code: "MP_TOKEN_MISSING",
      message: "Mercado Pago Access Token no configurado en el servidor. Configure MERCADO_PAGO_ACCESS_TOKEN en las variables de entorno."
    });
  }

  try {
    // Real call to Mercado Pago API to create an in-store QR order
    // Reference: v1/instore/qr/seller/collectors/{collector_id}/stores/{external_store_id}/pos/{external_pos_id}/orders
    const collectorId = process.env.MERCADO_PAGO_COLLECTOR_ID || "default";
    const storeId = process.env.MERCADO_PAGO_STORE_ID || "STORE001";
    const posId = process.env.MERCADO_PAGO_POS_ID || "POS001";

    const url = `https://api.mercadopago.com/instore/qr/seller/collectors/${collectorId}/stores/${storeId}/pos/${posId}/orders`;

    // Real API Request to Mercado Pago
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        external_reference: saleId,
        title: `Venta POS Argentina - #${saleId}`,
        description: "Cobro de Punto de Venta",
        total_amount: amount,
        items: items || [
          {
            title: "Venta General",
            unit_price: amount,
            quantity: 1,
            unit_measure: "unit",
            total_amount: amount
          }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(response.status).json({
        success: false,
        code: "MP_API_ERROR",
        message: errorData.message || "Error al crear la orden de pago en Mercado Pago",
        details: errorData
      });
    }

    const data = await response.json();
    return res.json({
      success: true,
      qrData: data.qr_data,
      inStoreOrderId: data.in_store_order_id,
      externalReference: saleId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      code: "MP_CONNECTION_FAILED",
      message: "No se pudo conectar con el servidor de Mercado Pago",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/mercadopago/verify-payment/:saleId", async (req, res) => {
  const { saleId } = req.params;
  const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;

  if (!token) {
    return res.status(400).json({
      success: false,
      code: "MP_TOKEN_MISSING",
      message: "Mercado Pago Access Token no configurado en el servidor."
    });
  }

  try {
    // Real call to check payment status by external_reference
    const url = `https://api.mercadopago.com/v1/payments/search?external_reference=${saleId}`;
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(response.status).json({
        success: false,
        message: errorData.message || "Error al buscar el pago en Mercado Pago"
      });
    }

    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      // Sort to find the latest payment attempt
      const latestPayment = data.results.sort((a: any, b: any) => 
        new Date(b.date_created).getTime() - new Date(a.date_created).getTime()
      )[0];

      return res.json({
        success: true,
        found: true,
        paymentId: latestPayment.id,
        status: latestPayment.status.toUpperCase(), // APPROVED, PENDING, REJECTED, etc.
        amount: latestPayment.transaction_amount,
        createdAt: latestPayment.date_created,
        details: {
          payment_method_id: latestPayment.payment_method_id,
          payment_type_id: latestPayment.payment_type_id
        }
      });
    }

    return res.json({
      success: true,
      found: false,
      status: "PENDING",
      message: "No se encontraron pagos aprobados o pendientes para esta referencia todavía."
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error de red al consultar a Mercado Pago",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Real webhook endpoint for instant payment notifications (IPN)
app.post("/api/webhooks/mercadopago", async (req, res) => {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
  const signature = req.headers['x-signature'] as string;
  const requestId = req.headers['x-request-id'] as string;
  
  if (!secret || !signature || !requestId) {
    return res.status(403).send("Forbidden: Missing signature or secret");
  }

  // Parse signature to get ts and v1
  const parts = signature.split(',').reduce((acc: any, part: string) => {
      const [key, value] = part.split('=');
      acc[key] = value;
      return acc;
  }, {});
  
  const { ts, v1 } = parts;
  if (!ts || !v1) return res.status(403).send("Forbidden: Invalid signature format");

  // Build manifest
  const manifest = `id:${req.body.data.id};request-id:${requestId};ts:${ts};`;
  
  // Calculate HMAC
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(manifest);
  const calculatedSignature = hmac.digest('hex');
  
  // Compare
  if (v1 !== calculatedSignature) {
    console.error("Webhook rejected: Invalid signature.");
    return res.status(403).send("Forbidden: Signature mismatch");
  }
  
  // Replay protection (Check timestamp)
  const eventTime = parseInt(ts);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - eventTime) > 300) {
      return res.status(403).send("Forbidden: Timestamp too old");
  }

  const { data, type } = req.body;
  if (type !== "payment") {
    return res.status(200).send("Ignored");
  }

  const paymentId = data.id;

  try {
    // 1. Idempotency Check
    const eventRef = dbAdmin.collection("mercadopago_events").doc(paymentId);
    const eventSnap = await eventRef.get();
    if (eventSnap.exists) {
      return res.status(200).send("Already processed");
    }

    // 2. Server-Side Verification with MP API
    const token = process.env.MERCADO_PAGO_ACCESS_TOKEN;
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    
    if (!mpResponse.ok) throw new Error("Failed to fetch payment status from MP");
    const paymentData = await mpResponse.json();

    // 3. Secure Processing (Transactional)
    const externalReference = paymentData.external_reference; // This is the saleId!
    
    // Find the businessId for this sale - simplified logic for demo
    // In production, you would map external_reference to a more structured ID or store businessId in external_reference
    const saleQuery = await dbAdmin.collectionGroup("sales").where("id", "==", externalReference).get();
    if (saleQuery.empty) throw new Error("Sale not found");
    const saleDoc = saleQuery.docs[0];
    const businessId = saleDoc.ref.path.split("/")[1];

    await dbAdmin.runTransaction(async (transaction) => {
      // Find the specific payment in the subcollection
      const paymentQuery = await saleDoc.ref.collection("payments").where("saleId", "==", externalReference).get();
      // This is complicated if we don't have a direct link to the payment record.
      // Let's assume we update the first matching payment record or create a new one if it's the right type.
      
      const paymentRef = dbAdmin.collection(`businesses/${businessId}/sales/${externalReference}/payments`).doc();
      transaction.set(paymentRef, {
        saleId: externalReference,
        method: 'MERCADO_PAGO',
        amount: paymentData.transaction_amount,
        status: paymentData.status.toUpperCase(), // APPROVED, etc.
        paymentId: paymentId,
        createdAt: new Date().toISOString()
      });

      // Update idempotency event
      transaction.set(eventRef, { paymentId, status: paymentData.status, processedAt: new Date().toISOString() });
    });

    console.log(`Webhook processed payment ${paymentId} for sale ${externalReference}`);
    res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).send("Error");
  }
});

// --- CLIENT STATIC / VITE MIDDLWARE SETUP ---
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[POS Argentina Server] Running on http://localhost:${PORT}`);
  });
}

startServer();
