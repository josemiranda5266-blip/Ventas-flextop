import React, { useState, useEffect, useRef } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, addDoc, getDocs, updateDoc, doc, setDoc, query, where, getDoc } from 'firebase/firestore';
import { Product, Category, Customer, Sale, SaleItem, SaleStatus, PaymentMethod, PaymentStatus, CashSession, UserProfile, StockMovementType } from '../../types';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { Search, ShoppingCart, User, Plus, Minus, Trash2, DollarSign, CreditCard, Layers, Tag, RefreshCw, X, Check, Printer, AlertTriangle } from 'lucide-react';

interface POSViewProps {
  userProfile: UserProfile;
  businessId: string;
  activeSession: CashSession | null;
  onRefreshCaja: () => void;
}

interface CartItem {
  product: Product;
  qty: number;
  customPrice?: number;
  discountPercent?: number; // 0-100%
}

export const POSView: React.FC<POSViewProps> = ({
  userProfile,
  businessId,
  activeSession,
  onRefreshCaja
}) => {
  // Master lists
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Cart / Sale states
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [generalDiscount, setGeneralDiscount] = useState<number>(0); // overall discount percent
  const [generalSurcharge, setGeneralSurcharge] = useState<number>(0); // overall surcharge percent

  // UI state
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [suspendedCarts, setSuspendedCarts] = useState<{ id: string; cart: CartItem[]; customer: Customer | null; date: string }[]>([]);
  const [productSearchQuery, setProductSearchQuery] = useState('');

  // Modals state
  const [isCobrarModalOpen, setIsCobrarModalOpen] = useState(false);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [isConsultarPrecioOpen, setIsConsultarPrecioOpen] = useState(false);
  const [isSuspendedModalOpen, setIsSuspendedModalOpen] = useState(false);

  // Price Consult state
  const [consultBarcode, setConsultBarcode] = useState('');
  const [consultedProduct, setConsultedProduct] = useState<Product | null>(null);

  // Cobro (Payment) state
  const [payEfectivo, setPayEfectivo] = useState<string>('');
  const [payDebito, setPayDebito] = useState<string>('');
  const [payCredito, setPayCredito] = useState<string>('');
  const [payTransferencia, setPayTransferencia] = useState<string>('');
  const [payMercadoPago, setPayMercadoPago] = useState<string>('');
  const [payCuentaCorriente, setPayCuentaCorriente] = useState<string>('');

  // Mercado Pago order state
  const [mpQrData, setMpQrData] = useState<string | null>(null);
  const [mpPaymentId, setMpPaymentId] = useState<string | null>(null);
  const [mpPaymentStatus, setMpPaymentStatus] = useState<string>('PENDING');
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [mpOrderReference, setMpOrderReference] = useState<string | null>(null);

  // Finished Ticket layout
  const [completedSaleDetails, setCompletedSaleDetails] = useState<{
    sale: Sale;
    items: CartItem[];
    payments: { method: string; amount: number }[];
  } | null>(null);

  const prodPath = `businesses/${businessId}/products`;
  const custPath = `businesses/${businessId}/customers`;
  const catPath = `businesses/${businessId}/categories`;

  useEffect(() => {
    fetchData();
  }, [businessId]);

  const fetchData = async () => {
    try {
      const pSnap = await getDocs(collection(db, prodPath));
      const pList: Product[] = [];
      pSnap.forEach((doc) => {
        const d = doc.data();
        if (d.status === 'ACTIVE') {
          pList.push({ id: doc.id, ...d } as Product);
        }
      });
      setProducts(pList);

      const cSnap = await getDocs(collection(db, custPath));
      const cList: Customer[] = [];
      cSnap.forEach((doc) => {
        cList.push({ id: doc.id, ...doc.data() } as Customer);
      });
      setCustomers(cList);

      const catSnap = await getDocs(collection(db, catPath));
      const catList: Category[] = [];
      catSnap.forEach((doc) => {
        catList.push({ id: doc.id, ...doc.data() } as Category);
      });
      setCategories(catList);
    } catch (error) {
      console.error(error);
    }
  };

  // --- MATH CALCS FOR SALE ---
  const calculateCartSubtotal = () => {
    return cart.reduce((sum, item) => {
      const price = item.customPrice !== undefined ? item.customPrice : item.product.salePrice;
      const discount = item.discountPercent ? (price * item.discountPercent) / 100 : 0;
      return sum + (price - discount) * item.qty;
    }, 0);
  };

  const getSurchargeAmount = () => {
    const sub = calculateCartSubtotal();
    return (sub * generalSurcharge) / 100;
  };

  const getDiscountAmount = () => {
    const sub = calculateCartSubtotal();
    return (sub * generalDiscount) / 100;
  };

  const calculateCartTotal = () => {
    const sub = calculateCartSubtotal();
    return sub + getSurchargeAmount() - getDiscountAmount();
  };

  // Calculate taxes (IVA sum) based on product taxRate (21%, 10.5%, etc)
  const calculateCartTaxes = () => {
    return cart.reduce((sum, item) => {
      const price = item.customPrice !== undefined ? item.customPrice : item.product.salePrice;
      const discount = item.discountPercent ? (price * item.discountPercent) / 100 : 0;
      const finalPrice = price - discount;
      const itemSubtotal = finalPrice * item.qty;
      const net = itemSubtotal / (1 + item.product.taxRate / 100);
      const tax = itemSubtotal - net;
      return sum + tax;
    }, 0);
  };

  // --- ACTIONS ---
  const addProductToCart = (prod: Product) => {
    if (prod.stock <= 0) {
      alert(`¡ATENCIÓN! El producto ${prod.name} no tiene stock disponible.`);
    }

    const existingIdx = cart.findIndex((item) => item.product.id === prod.id);
    if (existingIdx > -1) {
      const nextCart = [...cart];
      nextCart[existingIdx].qty += 1;
      setCart(nextCart);
    } else {
      setCart([...cart, { product: prod, qty: 1 }]);
    }
  };

  const handleRemoveItem = (prodId: string) => {
    setCart(cart.filter((item) => item.product.id !== prodId));
  };

  const handleUpdateQty = (prodId: string, delta: number) => {
    const nextCart = cart.map((item) => {
      if (item.product.id === prodId) {
        const nextQty = item.qty + delta;
        return nextQty > 0 ? { ...item, qty: nextQty } : item;
      }
      return item;
    });
    setCart(nextCart);
  };

  const handleUpdatePrice = (prodId: string, val: string) => {
    const parsed = parseFloat(val);
    const nextCart = cart.map((item) => {
      if (item.product.id === prodId) {
        return { ...item, customPrice: isNaN(parsed) ? undefined : parsed };
      }
      return item;
    });
    setCart(nextCart);
  };

  const handleUpdateItemDiscount = (prodId: string, val: string) => {
    const parsed = parseFloat(val);
    const nextCart = cart.map((item) => {
      if (item.product.id === prodId) {
        return { ...item, discountPercent: isNaN(parsed) ? undefined : parsed };
      }
      return item;
    });
    setCart(nextCart);
  };

  const handleBarcodeScanAction = (barcode: string) => {
    const matched = products.find((p) => p.barcode === barcode || p.code === barcode);
    if (matched) {
      addProductToCart(matched);
    } else {
      // Show sound or message
      alert(`PRODUCTO NO ENCONTRADO: ${barcode}`);
    }
  };

  // Register barcode scanner trigger hook
  useBarcodeScanner({
    onScan: handleBarcodeScanAction
  });

  // Hotkey keyboard assignments
  useKeyboardShortcuts({
    'F2': () => handleOpenCobrarModal(),
    'F4': () => handleNewVenta(),
    'F5': () => setIsConsultarPrecioOpen(true),
    'F6': () => setIsCustomerModalOpen(true),
    'F7': () => handleSuspendCart(),
    'F8': () => setIsSuspendedModalOpen(true),
    'Escape': () => {
      setIsCobrarModalOpen(false);
      setIsCustomerModalOpen(false);
      setIsConsultarPrecioOpen(false);
      setIsSuspendedModalOpen(false);
    }
  });

  const handleNewVenta = () => {
    setCart([]);
    setSelectedCustomer(null);
    setGeneralDiscount(0);
    setGeneralSurcharge(0);
    setCompletedSaleDetails(null);
    setMpQrData(null);
    setMpPaymentStatus('PENDING');
  };

  const handleOpenCobrarModal = () => {
    if (cart.length === 0) {
      alert("El carro de compras está vacío.");
      return;
    }
    if (!activeSession) {
      alert("Debe abrir la caja diaria para poder cobrar.");
      return;
    }

    // Prepopulate payments
    const total = calculateCartTotal();
    setPayEfectivo(total.toString());
    setPayDebito('');
    setPayCredito('');
    setPayTransferencia('');
    setPayMercadoPago('');
    setPayCuentaCorriente('');
    setIsCobrarModalOpen(true);
  };

  const handleSuspendCart = () => {
    if (cart.length === 0) return;
    const newSuspended = {
      id: Math.random().toString(36).substring(7).toUpperCase(),
      cart: [...cart],
      customer: selectedCustomer,
      date: new Date().toLocaleTimeString('es-AR')
    };
    setSuspendedCarts([...suspendedCarts, newSuspended]);
    setCart([]);
    setSelectedCustomer(null);
    alert(`Carro de compra suspendido. ID de recuperación rápida: ${newSuspended.id}`);
  };

  const handleRecoverCart = (suspendedId: string) => {
    const matched = suspendedCarts.find(c => c.id === suspendedId);
    if (matched) {
      setCart(matched.cart);
      setSelectedCustomer(matched.customer);
      setSuspendedCarts(suspendedCarts.filter(c => c.id !== suspendedId));
      setIsSuspendedModalOpen(false);
    }
  };

  // --- MERCADO PAGO INTEGRATIONS ---
  const handleGenerateMpQr = async () => {
    const total = calculateCartTotal();
    const saleRefId = `SALE_${Math.random().toString(36).substring(4).toUpperCase()}`;
    setMpOrderReference(saleRefId);
    setIsGeneratingQr(true);

    try {
      const response = await fetch('/api/mercadopago/create-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saleId: saleRefId,
          amount: total,
          items: cart.map(item => ({
            title: item.product.name,
            unit_price: item.customPrice || item.product.salePrice,
            quantity: item.qty,
            total_amount: (item.customPrice || item.product.salePrice) * item.qty
          }))
        })
      });

      const data = await response.json();
      if (data.success) {
        setMpQrData(data.qrData);
        setMpPaymentStatus('PENDING');
        // Pre-fill Mercado Pago amount
        setPayMercadoPago(total.toString());
        setPayEfectivo('0');
      } else {
        alert(`Error de Mercado Pago: ${data.message}`);
      }
    } catch (err) {
      alert("Error al conectarse con el servicio de cobros QR.");
    } finally {
      setIsGeneratingQr(false);
    }
  };

  const handleVerifyMpPayment = async () => {
    if (!mpOrderReference) return;
    try {
      const response = await fetch(`/api/mercadopago/verify-payment/${mpOrderReference}`);
      const data = await response.json();
      if (data.success && data.found) {
        setMpPaymentStatus(data.status);
        if (data.status === 'APPROVED') {
          setMpPaymentId(data.paymentId);
          alert("¡Pago aprobado por Mercado Pago!");
        } else if (data.status === 'REJECTED') {
          alert("El pago fue rechazado por la tarjeta o billetera del cliente.");
        }
      } else {
        alert("El pago sigue pendiente de acreditación...");
      }
    } catch (err) {
      alert("No se pudo verificar el estado del pago.");
    }
  };

  // --- SUBMIT COMPLETED SALE AND DECREASE STOCK ---
  const handleProcessCobro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) return;

    const total = calculateCartTotal();
    const ef = parseFloat(payEfectivo) || 0;
    const dbPay = parseFloat(payDebito) || 0;
    const crPay = parseFloat(payCredito) || 0;
    const trPay = parseFloat(payTransferencia) || 0;
    const mpPay = parseFloat(payMercadoPago) || 0;
    const ccPay = parseFloat(payCuentaCorriente) || 0;

    const totalPaid = ef + dbPay + crPay + trPay + mpPay + ccPay;

    // Strict payment match constraint
    if (Math.abs(totalPaid - total) > 0.1) {
      alert(`El total pagado ($${totalPaid.toLocaleString('es-AR')}) no coincide con el total de la venta ($${total.toLocaleString('es-AR')}).`);
      return;
    }

    if (ccPay > 0) {
      if (!selectedCustomer) {
        alert("Debe asignar un cliente registrado para habilitar el pago en cuenta corriente (Al Fiado).");
        return;
      }
      if (selectedCustomer.balance + ccPay > selectedCustomer.creditLimit) {
        alert(`Operación denegada: El cliente superará su límite de crédito disponible. Límite: $${selectedCustomer.creditLimit}. Saldo actual: $${selectedCustomer.balance}`);
        return;
      }
    }

    // Mercado Pago payment state constraint: STRICT ENFORCEMENT, NO MANUAL APPROVAL OVERRIDE
    if (mpPay > 0 && mpPaymentStatus !== 'APPROVED') {
      alert("ATENCIÓN: El pago con Mercado Pago no ha sido aprobado por la terminal. No se permiten aprobaciones manuales o forzadas por motivos de seguridad y auditoría financiera.");
      return;
    }

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        alert("No se pudo verificar su identidad de usuario. Por favor, intente iniciar sesión nuevamente.");
        return;
      }

      const saleId = mpOrderReference || `SALE_${Math.random().toString(36).substring(4).toUpperCase()}`;
      
      const subtotalVal = calculateCartSubtotal();
      const discVal = getDiscountAmount();
      const surVal = getSurchargeAmount();
      const taxVal = calculateCartTaxes();

      const response = await fetch('/api/sales/finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          businessId,
          branchId: userProfile.branchId,
          activeSessionId: activeSession.id,
          cart: cart.map(item => ({
            product: { id: item.product.id },
            qty: item.qty,
            customPrice: item.customPrice,
            discountPercent: item.discountPercent
          })),
          customerId: selectedCustomer?.id || undefined,
          generalDiscount,
          generalSurcharge,
          payments: [
            { method: 'EFECTIVO', amount: ef },
            { method: 'DEBITO', amount: dbPay },
            { method: 'CREDITO', amount: crPay },
            { method: 'TRANSFERENCIA', amount: trPay },
            { method: 'MERCADO_PAGO', amount: mpPay },
            { method: 'CUENTA_CORRIENTE', amount: ccPay }
          ].filter(p => p.amount > 0),
          mpOrderReference: mpPay > 0 ? mpOrderReference : undefined
        })
      });

      const resData = await response.json();
      if (!response.ok || !resData.success) {
        alert(`¡Error al procesar la venta en el servidor!: ${resData.message || 'Error desconocido'}`);
        return;
      }

      const pList: { method: string; amount: number }[] = [
        { method: 'EFECTIVO', amount: ef },
        { method: 'DEBITO', amount: dbPay },
        { method: 'CREDITO', amount: crPay },
        { method: 'TRANSFERENCIA', amount: trPay },
        { method: 'MERCADO_PAGO', amount: mpPay },
        { method: 'CUENTA_CORRIENTE', amount: ccPay }
      ].filter(p => p.amount > 0);

      // Show completed ticket in thermal mock view
      setCompletedSaleDetails({
        sale: {
          id: saleId,
          branchId: userProfile.branchId,
          registerId: 'REG_MAIN_01',
          sessionId: activeSession.id,
          userId: userProfile.id,
          userName: userProfile.name,
          customerId: selectedCustomer?.id || undefined,
          customerName: selectedCustomer?.name || undefined,
          subtotal: subtotalVal,
          discount: discVal,
          surcharge: surVal,
          taxTotal: taxVal,
          total: total,
          paymentMethod: ccPay > 0 ? 'CUENTA_CORRIENTE' : pList.length === 1 ? pList[0].method : 'MIXTO',
          status: SaleStatus.COMPLETED,
          isFiscal: false,
          createdAt: new Date().toISOString()
        } as Sale,
        items: [...cart],
        payments: pList
      });

      setIsCobrarModalOpen(false);
      onRefreshCaja();
      fetchData(); // reload stocks
    } catch (error) {
      alert("Error de conexión al intentar finalizar la venta de forma segura en el servidor.");
      console.error(error);
    }
  };

  const handleBarcodeConsult = () => {
    const matched = products.find(p => p.barcode === consultBarcode || p.code === consultBarcode);
    if (matched) {
      setConsultedProduct(matched);
    } else {
      setConsultedProduct(null);
    }
  };

  const handleProductQuickSearch = (query: string) => {
    setProductSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const matched = products.filter(p =>
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      p.code.toLowerCase().includes(query.toLowerCase()) ||
      (p.barcode && p.barcode.includes(query))
    ).slice(0, 8);
    setSearchResults(matched);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      
      {/* Header/Info band if Cash is closed */}
      {!activeSession && (
        <div className="mb-6 p-4 bg-rose-950 border border-rose-800 text-rose-300 rounded-lg flex items-center justify-between">
          <div className="flex items-center space-x-2 text-sm font-semibold">
            <AlertTriangle className="text-rose-400" size={20} />
            <span>LA CAJA ESTÁ CERRADA. ABRA LA CAJA DIARIA PARA REGISTRAR COBROS.</span>
          </div>
        </div>
      )}

      {/* Primary Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Cart Itemization List (Left & center) */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col min-h-[500px]">
          
          {/* Barcode scan input / fast product search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-3 text-slate-500" size={16} />
            <input
              type="text"
              placeholder="Escriba código o nombre de producto... (Escáner de código de barras activo en segundo plano)"
              value={productSearchQuery}
              onChange={(e) => handleProductQuickSearch(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-md pl-10 pr-4 py-3 text-xs font-mono focus:outline-none focus:border-emerald-500 text-slate-200"
            />

            {/* Quick search floating results */}
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-md overflow-hidden z-20 shadow-xl max-h-60 overflow-y-auto divide-y divide-slate-700 font-sans">
                {searchResults.map(p => (
                  <button
                    key={p.id}
                    onClick={() => {
                      addProductToCart(p);
                      setProductSearchQuery('');
                      setSearchResults([]);
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-750 text-xs text-slate-300 flex justify-between items-center transition-colors"
                  >
                    <div>
                      <span className="font-semibold text-slate-100 block">{p.name}</span>
                      <span className="text-[10px] text-slate-400 font-mono">Cód: {p.code} | Stock: {p.stock}</span>
                    </div>
                    <span className="font-bold text-emerald-400 font-mono">${p.salePrice.toLocaleString('es-AR')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cart Item list */}
          <div className="flex-1 overflow-y-auto max-h-[380px] pr-1 divide-y divide-slate-800">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16">
                <ShoppingCart size={48} className="text-slate-600 mb-2" />
                <p className="text-sm font-sans font-medium">Carro de venta vacío.</p>
                <p className="text-[11px] font-mono mt-0.5">Use el buscador superior o escanee productos.</p>
              </div>
            ) : (
              cart.map((item) => {
                const basePrice = item.product.salePrice;
                const price = item.customPrice !== undefined ? item.customPrice : basePrice;
                const discPercent = item.discountPercent || 0;
                const itemSub = (price - (price * discPercent) / 100) * item.qty;

                return (
                  <div key={item.product.id} className="py-3.5 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-bold text-slate-100 font-sans block truncate">{item.product.name}</span>
                      <span className="text-[10px] text-slate-400 font-mono">Cód: {item.product.code}</span>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center space-x-4">
                      {/* Qty adjustments */}
                      <div className="flex items-center space-x-1.5 bg-slate-800 px-2 py-1 rounded">
                        <button onClick={() => handleUpdateQty(item.product.id, -1)} className="text-slate-400 hover:text-slate-200">
                          <Minus size={12} />
                        </button>
                        <span className="text-xs font-mono font-bold w-6 text-center text-slate-100">{item.qty}</span>
                        <button onClick={() => handleUpdateQty(item.product.id, 1)} className="text-slate-400 hover:text-slate-200">
                          <Plus size={12} />
                        </button>
                      </div>

                      {/* Custom Price inline input */}
                      <div className="w-20">
                        <input
                          type="number"
                          value={item.customPrice !== undefined ? item.customPrice : price}
                          onChange={(e) => handleUpdatePrice(item.product.id, e.target.value)}
                          className="w-full bg-slate-800 border border-slate-700 rounded text-center py-1 font-mono text-[11px] text-slate-200 focus:outline-none"
                          title="Precio Unitario"
                        />
                      </div>

                      {/* Item Discount percent inline */}
                      <div className="w-16 flex items-center bg-slate-800 border border-slate-700 px-1 rounded">
                        <input
                          type="number"
                          value={item.discountPercent || ''}
                          onChange={(e) => handleUpdateItemDiscount(item.product.id, e.target.value)}
                          className="w-full bg-transparent text-center py-1 font-mono text-[11px] text-slate-200 focus:outline-none"
                          placeholder="Desc %"
                          max={100}
                        />
                        <span className="text-[10px] text-slate-500 font-mono">%</span>
                      </div>

                      {/* Subtotal label */}
                      <div className="w-24 text-right">
                        <span className="text-xs font-bold text-slate-100 font-mono">${itemSub.toLocaleString('es-AR')}</span>
                      </div>

                      {/* Delete */}
                      <button onClick={() => handleRemoveItem(item.product.id)} className="text-slate-500 hover:text-rose-400">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Quick keyboard key guides footer */}
          <div className="pt-4 border-t border-slate-800 grid grid-cols-4 gap-2 text-[10px] font-mono text-slate-400 mt-4">
            <div>F2: COBRAR</div>
            <div>F4: NUEVA VENTA</div>
            <div>F5: CONSULTAR PRECIO</div>
            <div>F6: ASIGNAR CLIENTE</div>
            <div>F7: SUSPENDER</div>
            <div>F8: RECUPERAR</div>
            <div>ESC: CERRAR VENTANAS</div>
          </div>

        </div>

        {/* Sales operations, Totals & Billing Side (Right) */}
        <div className="lg:col-span-1 space-y-6">
          
          {/* Active Cart Totals */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-4 shadow-lg">
            
            {/* Customer assignment info card */}
            <div className="flex justify-between items-center bg-slate-950 px-3 py-2 rounded-lg border border-slate-850">
              <div className="flex items-center space-x-2 truncate">
                <User size={14} className="text-emerald-400" />
                <span className="text-[11px] font-mono text-slate-300 uppercase font-semibold truncate">
                  {selectedCustomer ? selectedCustomer.name : "CONSUMIDOR FINAL"}
                </span>
              </div>
              <button
                onClick={() => setIsCustomerModalOpen(true)}
                className="text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded uppercase hover:bg-emerald-900/30"
              >
                ASIGNAR
              </button>
            </div>

            {/* Subtotal, discount parameters */}
            <div className="space-y-2 font-mono text-[11px] text-slate-400 pt-2">
              <div className="flex justify-between">
                <span>Subtotal General:</span>
                <span className="text-slate-200">${calculateCartSubtotal().toLocaleString('es-AR')}</span>
              </div>
              
              <div className="flex justify-between items-center">
                <span>Descuento Carro:</span>
                <div className="flex items-center space-x-1.5 bg-slate-800 px-1 rounded w-16">
                  <input
                    type="number"
                    value={generalDiscount}
                    onChange={(e) => setGeneralDiscount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-transparent text-right pr-0.5 text-slate-200 focus:outline-none font-mono text-xs"
                    placeholder="0"
                  />
                  <span className="text-slate-500">%</span>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span>Recargo Carro:</span>
                <div className="flex items-center space-x-1.5 bg-slate-800 px-1 rounded w-16">
                  <input
                    type="number"
                    value={generalSurcharge}
                    onChange={(e) => setGeneralSurcharge(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-transparent text-right pr-0.5 text-slate-200 focus:outline-none font-mono text-xs"
                    placeholder="0"
                  />
                  <span className="text-slate-500">%</span>
                </div>
              </div>

              <div className="flex justify-between">
                <span>Total IVA (IVA Inc.):</span>
                <span>${calculateCartTaxes().toLocaleString('es-AR')}</span>
              </div>
            </div>

            <div className="h-px bg-slate-800" />

            <div className="flex justify-between items-end pb-2">
              <span className="text-xs font-bold text-slate-300 font-sans uppercase">TOTAL DE VENTA:</span>
              <span className="text-3xl font-extrabold text-emerald-400 font-mono">
                ${calculateCartTotal().toLocaleString('es-AR')}
              </span>
            </div>

            {/* Big checkout triggers */}
            <div className="grid grid-cols-1 gap-2 pt-2">
              <button
                onClick={handleOpenCobrarModal}
                disabled={!activeSession}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 font-extrabold text-sm uppercase tracking-wider rounded-lg shadow transition-all duration-150 transform hover:scale-[1.01]"
              >
                COBRAR VENTA (F2)
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleSuspendCart}
                  className="py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase tracking-wider rounded"
                >
                  SUSPENDER (F7)
                </button>
                <button
                  onClick={handleNewVenta}
                  className="py-2.5 bg-slate-800 hover:bg-rose-950/40 hover:text-rose-400 text-slate-400 font-bold text-xs uppercase tracking-wider rounded"
                >
                  NUEVA VENTA (F4)
                </button>
              </div>
            </div>
          </div>

          {/* Quick Price Consult panel */}
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-sans">Consulta de Precios Rápida</h4>
            <div className="flex space-x-2">
              <input
                type="text"
                placeholder="Código de barra o SKU..."
                value={consultBarcode}
                onChange={(e) => setConsultBarcode(e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-mono focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={handleBarcodeConsult}
                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded text-xs font-bold uppercase transition-colors"
              >
                BUSCAR
              </button>
            </div>

            {consultedProduct ? (
              <div className="p-3 bg-slate-950 rounded border border-slate-850 font-sans">
                <span className="font-bold text-xs text-slate-200 block">{consultedProduct.name}</span>
                <span className="text-[10px] text-slate-400 font-mono block">SKU: {consultedProduct.code} | Stock: {consultedProduct.stock}</span>
                <div className="flex justify-between items-end mt-2">
                  <span className="text-[10px] text-slate-500 font-mono">Precio Público:</span>
                  <span className="text-lg font-extrabold text-emerald-400 font-mono">${consultedProduct.salePrice.toLocaleString('es-AR')}</span>
                </div>
                <button
                  onClick={() => {
                    addProductToCart(consultedProduct);
                    setConsultedProduct(null);
                    setConsultBarcode('');
                  }}
                  className="w-full bg-emerald-500/15 hover:bg-emerald-500/35 border border-emerald-900 text-emerald-400 font-bold text-[10px] py-1 rounded mt-2.5 tracking-wider uppercase"
                >
                  Añadir al Carro
                </button>
              </div>
            ) : consultBarcode && (
              <p className="text-[11px] text-rose-400 font-mono">Ningún producto coincide con ese código.</p>
            )}
          </div>

          {/* Thermal Mock Ticket Display */}
          {completedSaleDetails && (
            <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-300 font-mono uppercase">VISTA PREVIA TIQUE</span>
                <button onClick={() => setCompletedSaleDetails(null)} className="text-slate-500 hover:text-slate-200">
                  <X size={14} />
                </button>
              </div>

              {/* Thermal ticket container */}
              <div className="bg-white text-slate-950 p-6 rounded shadow font-mono text-[10px] leading-snug tracking-tight select-none">
                <div className="text-center font-bold">
                  <h5 className="text-xs uppercase font-extrabold">{businessId.replace('_', ' ').toUpperCase()}</h5>
                  <p className="font-medium text-[9px] uppercase">Sucursal principal POS</p>
                  <p className="text-[9px] font-normal mt-0.5">CUIT: {process.env.ARCA_CUIT || "30-12345678-9"}</p>
                  <p className="text-[8px] font-normal leading-none">Condición: Responsable Inscripto</p>
                </div>
                
                <div className="h-px border-t border-dashed border-slate-400 my-2" />

                <div className="space-y-0.5">
                  <p>FECHA: {new Date(completedSaleDetails.sale.createdAt).toLocaleDateString('es-AR')} {new Date(completedSaleDetails.sale.createdAt).toLocaleTimeString('es-AR')}</p>
                  <p>COMPROBANTE: TIQUE COMERCIAL PROVISORIO</p>
                  <p className="uppercase">Vendedor: {completedSaleDetails.sale.userName || "CAJERO"}</p>
                  <p className="uppercase truncate">Cliente: {completedSaleDetails.sale.customerName || "CONSUMIDOR FINAL"}</p>
                </div>

                <div className="h-px border-t border-dashed border-slate-400 my-2" />

                <table className="w-full text-[9px]">
                  <thead>
                    <tr className="border-b border-dashed border-slate-400 text-left font-bold">
                      <th className="pb-1">DETALLE</th>
                      <th className="pb-1 text-center">CANT</th>
                      <th className="pb-1 text-right">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dashed divide-slate-200">
                    {completedSaleDetails.items.map(item => {
                      const itemPrice = item.customPrice || item.product.salePrice;
                      const discPercent = item.discountPercent || 0;
                      const finalPrice = itemPrice - (itemPrice * discPercent) / 100;
                      return (
                        <tr key={item.product.id}>
                          <td className="py-1 uppercase max-w-[120px] truncate">{item.product.name}</td>
                          <td className="py-1 text-center font-bold">x{item.qty}</td>
                          <td className="py-1 text-right">${(finalPrice * item.qty).toLocaleString('es-AR')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="h-px border-t border-dashed border-slate-400 my-2" />

                <div className="space-y-1 text-right font-bold text-[9px]">
                  <p>Subtotal: ${completedSaleDetails.sale.subtotal.toLocaleString('es-AR')}</p>
                  {completedSaleDetails.sale.discount > 0 && <p>Descuento: -${completedSaleDetails.sale.discount.toLocaleString('es-AR')}</p>}
                  {completedSaleDetails.sale.surcharge > 0 && <p>Recargo: +${completedSaleDetails.sale.surcharge.toLocaleString('es-AR')}</p>}
                  <p className="text-xs">TOTAL NETO: ${completedSaleDetails.sale.total.toLocaleString('es-AR')}</p>
                </div>

                <div className="h-px border-t border-dashed border-slate-400 my-2" />

                <div className="space-y-0.5">
                  <p className="font-bold">DESGLOSE DE PAGO:</p>
                  {completedSaleDetails.payments.map(p => (
                    <p key={p.method} className="uppercase ml-2">• {p.method.replace('_', ' ')}: ${p.amount.toLocaleString('es-AR')}</p>
                  ))}
                </div>

                <div className="h-px border-t border-dashed border-slate-400 my-3" />

                <div className="text-center text-[8px] space-y-1">
                  <p className="font-bold uppercase">¡Gracias por su compra!</p>
                  <p className="text-slate-500">POS ARGENTINA - PLATAFORMA OFICIAL</p>
                </div>
              </div>

              <button
                onClick={() => {
                  window.print();
                }}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2 rounded text-xs flex items-center justify-center space-x-1.5 transition-colors"
              >
                <Printer size={14} />
                <span>IMPRIMIR COMPROBANTE</span>
              </button>
            </div>
          )}

        </div>
      </div>

      {/* --- MODAL: COBRAR VENTA (F2) --- */}
      {isCobrarModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-slate-200">Procesar Cobro de Venta</h3>
              <button onClick={() => setIsCobrarModalOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleProcessCobro} className="p-6 space-y-5">
              <div className="flex justify-between items-end bg-slate-950 p-4 rounded-lg border border-slate-850">
                <span className="text-xs font-bold text-slate-400 uppercase">Total a Cobrar:</span>
                <span className="text-3xl font-extrabold text-emerald-400 font-mono">${calculateCartTotal().toLocaleString('es-AR')}</span>
              </div>

              {/* Payment split inputs */}
              <div className="space-y-3 font-mono">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-sans mb-1">Métodos de Cobro (Cobro Mixto)</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  {/* Efectivo */}
                  <div>
                    <label className="block text-[10px] text-slate-400 uppercase mb-1">Efectivo ($)</label>
                    <input
                      type="number"
                      value={payEfectivo}
                      onChange={(e) => setPayEfectivo(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-100"
                      placeholder="0.00"
                    />
                  </div>

                  {/* Debito */}
                  <div>
                    <label className="block text-[10px] text-slate-400 uppercase mb-1">Tarjeta de Débito ($)</label>
                    <input
                      type="number"
                      value={payDebito}
                      onChange={(e) => setPayDebito(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-100"
                      placeholder="0.00"
                    />
                  </div>

                  {/* Credito */}
                  <div>
                    <label className="block text-[10px] text-slate-400 uppercase mb-1">Tarjeta de Crédito ($)</label>
                    <input
                      type="number"
                      value={payCredito}
                      onChange={(e) => setPayCredito(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-100"
                      placeholder="0.00"
                    />
                  </div>

                  {/* Transferencia */}
                  <div>
                    <label className="block text-[10px] text-slate-400 uppercase mb-1">Transferencia ($)</label>
                    <input
                      type="number"
                      value={payTransferencia}
                      onChange={(e) => setPayTransferencia(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-100"
                      placeholder="0.00"
                    />
                  </div>

                  {/* Mercado Pago QR */}
                  <div>
                    <label className="block text-[10px] text-slate-400 uppercase mb-1">Mercado Pago QR ($)</label>
                    <input
                      type="number"
                      value={payMercadoPago}
                      onChange={(e) => setPayMercadoPago(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-100"
                      placeholder="0.00"
                    />
                  </div>

                  {/* Cuenta Corriente */}
                  <div>
                    <label className="block text-[10px] text-slate-400 uppercase mb-1">Al Fiado / Cuenta Corriente ($)</label>
                    <input
                      type="number"
                      disabled={!selectedCustomer}
                      value={payCuentaCorriente}
                      onChange={(e) => setPayCuentaCorriente(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs text-slate-100 disabled:opacity-45"
                      placeholder={selectedCustomer ? "0.00" : "Asigne un cliente..."}
                    />
                  </div>
                </div>
              </div>

              {/* Mercado Pago QR Generator component */}
              <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-bold text-slate-200">Terminal Digital de Mercado Pago</span>
                  <button
                    type="button"
                    onClick={handleGenerateMpQr}
                    disabled={isGeneratingQr}
                    className="bg-sky-600 hover:bg-sky-500 text-white font-bold text-[10px] px-3 py-1 rounded transition-colors"
                  >
                    {isGeneratingQr ? "GENERANDO QR..." : "GENERAR ORDEN QR"}
                  </button>
                </div>

                {mpQrData ? (
                  <div className="flex flex-col items-center p-3 bg-white rounded text-slate-900 space-y-2">
                    <span className="text-[9px] font-bold text-slate-500 font-mono">ESCANEÁ CON LA APP DE MERCADO PAGO</span>
                    
                    {/* Real raw QR payload visualised dynamically */}
                    <div className="p-2 border border-slate-300 rounded font-mono text-[9px] break-all max-w-xs text-center bg-slate-50">
                      {mpQrData.substring(0, 80)}...
                    </div>

                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={handleVerifyMpPayment}
                        className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-[10px] px-4 py-1.5 rounded"
                      >
                        VERIFICAR PAGO
                      </button>
                    </div>
                    <span className="text-[9px] font-bold font-mono">
                      Estado: <span className={mpPaymentStatus === 'APPROVED' ? 'text-emerald-600' : 'text-amber-600'}>{mpPaymentStatus}</span>
                    </span>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-500 font-sans">Presione generar para enviar el total a cobrar de la orden directo a la terminal de Mercado Pago.</p>
                )}
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCobrarModalOpen(false)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-4 py-2 rounded text-xs transition-colors"
                >
                  CANCELAR
                </button>
                <button
                  type="submit"
                  className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-4 py-2 rounded text-xs uppercase tracking-wider transition-colors"
                >
                  CONFIRMAR COBRO (ENTER)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL: CLIENT SELECTOR --- */}
      {isCustomerModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-slate-200">Asignar Cliente a Venta</h3>
              <button onClick={() => setIsCustomerModalOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-2 text-slate-500" size={16} />
                <input
                  type="text"
                  placeholder="Escriba nombre o DNI/CUIT..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded pl-10 pr-4 py-1.5 text-xs"
                />
              </div>

              <div className="space-y-1.5 max-h-60 overflow-y-auto font-mono text-xs">
                {/* Default Consumidor final option */}
                <button
                  onClick={() => {
                    setSelectedCustomer(null);
                    setIsCustomerModalOpen(false);
                    setSearchTerm('');
                  }}
                  className="w-full text-left px-3 py-2.5 bg-slate-800/40 hover:bg-slate-750 text-slate-200 rounded flex justify-between items-center transition-colors"
                >
                  <span className="font-bold">CONSUMIDOR FINAL</span>
                  <Check size={14} className="text-emerald-400" />
                </button>

                {customers
                  .filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()) || (c.dni && c.dni.includes(searchTerm)))
                  .map(c => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelectedCustomer(c);
                        setIsCustomerModalOpen(false);
                        setSearchTerm('');
                      }}
                      className="w-full text-left px-3 py-2.5 bg-slate-850 hover:bg-slate-750 text-slate-300 rounded flex justify-between items-center transition-colors"
                    >
                      <div>
                        <span className="font-semibold text-slate-200 block">{c.name}</span>
                        <span className="text-[10px] text-slate-400">DNI: {c.dni || 'Sin DNI'} | Deuda: ${c.balance}</span>
                      </div>
                      {selectedCustomer?.id === c.id && <Check size={14} className="text-emerald-400" />}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: RECOVER SUSPENDED CART --- */}
      {isSuspendedModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-slate-200 font-sans">Recuperar Carro Suspendido</h3>
              <button onClick={() => setIsSuspendedModalOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4 font-mono text-xs text-slate-300">
              {suspendedCarts.length === 0 ? (
                <p className="text-center text-slate-500 py-6">No hay carros de compra suspendidos actualmente.</p>
              ) : (
                <div className="space-y-2">
                  {suspendedCarts.map(item => (
                    <div key={item.id} className="p-3 bg-slate-850 rounded border border-slate-750 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-slate-100">Código: {item.id}</span>
                        <p className="text-[10px] text-slate-400">Hora: {item.date} | Artículos: {item.cart.reduce((sum, i) => sum + i.qty, 0)}</p>
                      </div>
                      <button
                        onClick={() => handleRecoverCart(item.id)}
                        className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-[10px] px-3 py-1 rounded tracking-wider uppercase"
                      >
                        Recuperar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
