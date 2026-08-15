import React, { useState, useEffect } from 'react';
import { auth, db, googleProvider, testConnection } from './lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, getDocs, query, where, addDoc } from 'firebase/firestore';
import { UserProfile, Business, Branch, CashSession, UserRole, CashSessionStatus, Product, Category, Customer } from './types';
import { Navbar } from './components/Layout/Navbar';
import { POSView } from './components/POS/POSView';
import { CajaView } from './components/Caja/CajaView';
import { StockView } from './components/Stock/StockView';
import { CustomersView } from './components/Customers/CustomersView';
import { Layers, Shield, Key, Sparkles, LogIn, Store, ShoppingBag, ArrowRight } from 'lucide-react';

export default function App() {
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [activeBusiness, setActiveBusiness] = useState<Business | null>(null);
  const [activeBranch, setActiveBranch] = useState<Branch | null>(null);
  const [activeSession, setActiveSession] = useState<CashSession | null>(null);

  // App states
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [currentView, setCurrentView] = useState<'pos' | 'caja' | 'stock' | 'customers'>('pos');

  // Business registration state
  const [registeringBusiness, setRegisteringBusiness] = useState(false);
  const [regName, setRegName] = useState('');
  const [regCuit, setRegCuit] = useState('30-98765432-1');
  const [regTaxCond, setRegTaxCond] = useState('Responsable Inscripto');

  // Listen to network status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Mandatorily test connection on boot
    testConnection();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Listen to authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setFbUser(user);
        await loadUserHierarchy(user.uid);
      } else {
        setFbUser(null);
        setUserProfile(null);
        setActiveBusiness(null);
        setActiveBranch(null);
        setActiveSession(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Load profile and related business entities
  const loadUserHierarchy = async (uid: string) => {
    try {
      setLoading(true);
      // We look up user records dynamically.
      // Since it's multi-tenant, we first query all users collections.
      // To simplify, we can store user profile references, or let the user choose/register.
      // If the user has a businessId saved in localStorage, we can check that.
      let businessId = localStorage.getItem('pos_active_business_id');

      if (!businessId) {
        // If not found in cache, we scan businesses or request registration
        setRegisteringBusiness(true);
        setLoading(false);
        return;
      }

      const userDocRef = doc(db, `businesses/${businessId}/users`, uid);
      const userSnap = await getDoc(userDocRef);

      if (userSnap.exists()) {
        const profile = userSnap.data() as UserProfile;
        setUserProfile(profile);

        // Load Business
        const bizSnap = await getDoc(doc(db, `businesses/${businessId}`));
        if (bizSnap.exists()) {
          setActiveBusiness(bizSnap.data() as Business);
        }

        // Load Branch
        const branchSnap = await getDoc(doc(db, `businesses/${businessId}/branches`, profile.branchId));
        if (branchSnap.exists()) {
          setActiveBranch(branchSnap.data() as Branch);
        }

        // Check active cash session
        await checkActiveCashSession(businessId, profile.branchId, uid);
        setRegisteringBusiness(false);
      } else {
        // No profile exists for this businessId
        setRegisteringBusiness(true);
      }
    } catch (error) {
      console.error("Error loading hierarchy:", error);
    } finally {
      setLoading(false);
    }
  };

  const checkActiveCashSession = async (businessId: string, branchId: string, uid: string) => {
    try {
      const sessionsPath = `businesses/${businessId}/branches/${branchId}/cash_sessions`;
      const q = query(
        collection(db, sessionsPath),
        where('openedBy', '==', uid),
        where('status', '==', CashSessionStatus.OPEN)
      );
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const activeDoc = querySnapshot.docs[0];
        setActiveSession({ id: activeDoc.id, ...activeDoc.data() } as CashSession);
      } else {
        setActiveSession(null);
        // Force view to Caja to open it
        setCurrentView('caja');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Error logging in:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  // Create a brand new business & register the user as ADMINISTRADOR
  const handleRegisterBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fbUser) return;
    if (!regName.trim() || !regCuit.trim()) {
      alert("Por favor complete todos los datos obligatorios.");
      return;
    }

    try {
      setLoading(true);
      const businessId = `BIZ_${Math.random().toString(36).substring(4).toUpperCase()}`;
      
      // 1. Create Business
      await setDoc(doc(db, `businesses/${businessId}`), {
        id: businessId,
        name: regName.trim(),
        cuit: regCuit.trim(),
        taxCondition: regTaxCond,
        createdAt: new Date().toISOString()
      });

      // 2. Create default Main Branch
      const branchId = 'B_MAIN';
      await setDoc(doc(db, `businesses/${businessId}/branches`, branchId), {
        id: branchId,
        name: 'Sucursal Centro',
        address: 'Av. Corrientes 1245, CABA',
        createdAt: new Date().toISOString()
      });

      // 3. Create default Cash Register
      await setDoc(doc(db, `businesses/${businessId}/branches/${branchId}/cash_registers`, 'REG_MAIN_01'), {
        id: 'REG_MAIN_01',
        branchId,
        name: 'Terminal 01 Principal',
        status: 'CLOSED',
        createdAt: new Date().toISOString()
      });

      // 4. Create User Profile
      const userProfileData: UserProfile = {
        id: fbUser.uid,
        email: fbUser.email || '',
        name: fbUser.displayName || 'Administrador',
        role: UserRole.ADMINISTRADOR,
        branchId,
        createdAt: new Date().toISOString()
      };
      await setDoc(doc(db, `businesses/${businessId}/users`, fbUser.uid), {
        ...userProfileData
      });

      // 5. Setup default categories & products to seed the app so it's not blank
      await seedInitialData(businessId);

      // Save to cache & load
      localStorage.setItem('pos_active_business_id', businessId);
      await loadUserHierarchy(fbUser.uid);
    } catch (error) {
      console.error("Error registering business:", error);
    } finally {
      setLoading(false);
    }
  };

  // Seed default Argentine shop categories, customers and products
  const seedInitialData = async (bizId: string) => {
    try {
      // Categories
      const cats = ['Almacén', 'Bebidas', 'Limpieza'];
      const catIds: string[] = [];

      for (const catName of cats) {
        const catRef = doc(collection(db, `businesses/${bizId}/categories`));
        await setDoc(catRef, {
          name: catName,
          createdAt: new Date().toISOString()
        });
        catIds.push(catRef.id);
      }

      // Products
      const initialProducts = [
        { code: 'ALM01', barcode: '7790040112345', name: 'Yerba Mate Playadito 1kg', description: 'Yerba mate con palo premium', categoryId: catIds[0], costPrice: 2200, salePrice: 3800, margin: 72, taxRate: 21, stock: 45, minStock: 10, maxStock: 100, status: 'ACTIVE', createdAt: new Date().toISOString() },
        { code: 'ALM02', barcode: '7791234560012', name: 'Galletitas Criollitas 3 x 100g', description: 'Galletitas de agua clásicas', categoryId: catIds[0], costPrice: 800, salePrice: 1400, margin: 75, taxRate: 21, stock: 60, minStock: 15, maxStock: 150, status: 'ACTIVE', createdAt: new Date().toISOString() },
        { code: 'BEB01', barcode: '7790895000453', name: 'Coca Cola Sabor Original 1.5L', description: 'Bebida gaseosa refrescante', categoryId: catIds[1], costPrice: 1100, salePrice: 1950, margin: 77, taxRate: 21, stock: 80, minStock: 20, maxStock: 200, status: 'ACTIVE', createdAt: new Date().toISOString() },
        { code: 'BEB02', barcode: '7791234560029', name: 'Cerveza Quilmes Clásica Lata 473ml', description: 'Cerveza rubia argentina', categoryId: catIds[1], costPrice: 950, salePrice: 1600, margin: 68, taxRate: 21, stock: 120, minStock: 24, maxStock: 300, status: 'ACTIVE', createdAt: new Date().toISOString() },
        { code: 'LIM01', barcode: '7793456780011', name: 'Lavandina Ayudín Tradicional 1L', description: 'Desinfectante líquido de superficies', categoryId: catIds[2], costPrice: 750, salePrice: 1300, margin: 73, taxRate: 21, stock: 35, minStock: 8, maxStock: 80, status: 'ACTIVE', createdAt: new Date().toISOString() }
      ];

      for (const p of initialProducts) {
        const pRef = doc(collection(db, `businesses/${bizId}/products`));
        await setDoc(pRef, p);
        
        // Stock Movement (Kardex)
        await addDoc(collection(db, `businesses/${bizId}/stock_movements`), {
          productId: pRef.id,
          productName: p.name,
          type: 'ENTRADA',
          qtyPrevious: 0,
          qtyChange: p.stock,
          qtyAfter: p.stock,
          reason: "Carga inicial de sistema",
          userId: fbUser?.uid || 'system',
          createdAt: new Date().toISOString()
        });
      }

      // Default customer
      const custRef = doc(collection(db, `businesses/${bizId}/customers`));
      await setDoc(custRef, {
        name: 'Carlos Alberto Rodríguez',
        dni: '28456123',
        taxCondition: 'Consumidor Final',
        creditLimit: 50000,
        balance: 0,
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
      });

    } catch (err) {
      console.error("Error seeding initial data:", err);
    }
  };

  const handleRefreshCaja = () => {
    if (fbUser && userProfile && activeBusiness) {
      checkActiveCashSession(activeBusiness.id, userProfile.branchId, fbUser.uid);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center font-sans">
        <Layers className="text-emerald-400 animate-pulse mb-4" size={48} />
        <h1 className="text-lg font-bold uppercase tracking-wider font-mono">Cargando POS Argentina...</h1>
        <p className="text-xs text-slate-500 font-mono mt-1">Conectando con bases de datos seguras</p>
      </div>
    );
  }

  // --- VIEW: LOGIN / ANONYMOUS ENTRY ---
  if (!fbUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-8 shadow-2xl relative overflow-hidden">
          
          {/* Accent decoration */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-sky-500" />

          <div className="text-center space-y-4 mb-8">
            <div className="inline-flex p-3.5 bg-emerald-500/10 text-emerald-400 rounded-xl">
              <Layers size={36} />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-100 font-sans tracking-tight">Punto de Venta Profesional</h1>
              <p className="text-xs text-emerald-400 font-mono tracking-widest uppercase mt-1 leading-none">POS Argentina</p>
            </div>
            <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
              Gestión comercial independiente de cajas diarias, stock masivo con pistola laser, facturación de ARCA y cobros QR interoperables de Mercado Pago.
            </p>
          </div>

          <div className="space-y-4">
            <button
              onClick={handleLogin}
              className="w-full py-3.5 px-4 bg-slate-800 hover:bg-slate-755 border border-slate-700 text-slate-100 font-bold rounded-lg flex items-center justify-center space-x-3 transition-colors text-sm shadow-md cursor-pointer"
            >
              <LogIn size={18} className="text-emerald-400" />
              <span>Acceder con cuenta de Google</span>
            </button>
            
            <p className="text-[10px] text-center text-slate-500 font-mono leading-normal">
              Sistema multi-tenant seguro homologado bajo normativas vigentes del Mercado Argentino.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- VIEW: BUSINESS REGISTER ---
  if (registeringBusiness) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-8 shadow-2xl relative">
          
          <div className="text-center mb-6">
            <div className="inline-flex p-3.5 bg-sky-500/10 text-sky-400 rounded-xl mb-3">
              <Store size={32} />
            </div>
            <h2 className="text-xl font-bold text-slate-100 font-sans">Alta de Comercio Multi-Tenant</h2>
            <p className="text-xs text-slate-400 font-mono mt-1">Registre su comercio para aprovisionar su base de datos.</p>
          </div>

          <form onSubmit={handleRegisterBusiness} className="space-y-4 font-sans text-xs">
            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase">Nombre Fantasía del Comercio *</label>
              <input
                type="text"
                required
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2.5 rounded focus:outline-none focus:border-emerald-500 font-sans"
                placeholder="Ej. Kiosco El Ceibo"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase">CUIT del Comercio *</label>
                <input
                  type="text"
                  required
                  value={regCuit}
                  onChange={(e) => setRegCuit(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2.5 rounded focus:outline-none focus:border-emerald-500 font-mono"
                  placeholder="30-12345678-9"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase">Condición Fiscal *</label>
                <select
                  value={regTaxCond}
                  onChange={(e) => setRegTaxCond(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2.5 rounded focus:outline-none focus:border-emerald-500"
                >
                  <option value="Responsable Inscripto">Responsable Inscripto</option>
                  <option value="Monotributista">Monotributista</option>
                  <option value="Exento">Exento</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-extrabold tracking-wider uppercase rounded-lg shadow-md transition-all flex items-center justify-center space-x-2"
            >
              <span>APROVISIONAR COMERCIO</span>
              <ArrowRight size={16} />
            </button>
          </form>

          <div className="h-px bg-slate-800 my-4" />
          
          <button
            onClick={handleLogout}
            className="w-full text-center text-xs text-slate-500 hover:text-rose-400 transition-colors py-2 font-mono"
          >
            Volver / Salir de Cuenta Google
          </button>
        </div>
      </div>
    );
  }

  // --- VIEW: DASHBOARD PANEL SYSTEM ---
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Header bar */}
      <Navbar
        userProfile={userProfile}
        activeBusiness={activeBusiness}
        activeBranch={activeBranch}
        activeSession={activeSession}
        isOnline={isOnline}
        onLogout={handleLogout}
        onChangeView={(v) => {
          // If Caja is closed, enforce opening session first
          if (!activeSession && v !== 'caja') {
            alert("Su sesión de caja está cerrada. Diríjase al módulo de Caja Diaria para abrirla antes de operar.");
            setCurrentView('caja');
          } else {
            setCurrentView(v);
          }
        }}
        currentView={currentView}
      />

      {/* Main View Area */}
      <main className="flex-1 bg-slate-950">
        
        {currentView === 'pos' && userProfile && activeBusiness && (
          <POSView
            userProfile={userProfile}
            businessId={activeBusiness.id}
            activeSession={activeSession}
            onRefreshCaja={handleRefreshCaja}
          />
        )}

        {currentView === 'caja' && userProfile && activeBusiness && (
          <CajaView
            userProfile={userProfile}
            businessId={activeBusiness.id}
            activeSession={activeSession}
            onSessionOpened={(session) => {
              setActiveSession(session);
              setCurrentView('pos');
            }}
            onSessionClosed={() => {
              setActiveSession(null);
            }}
          />
        )}

        {currentView === 'stock' && userProfile && activeBusiness && (
          <StockView
            userProfile={userProfile}
            businessId={activeBusiness.id}
          />
        )}

        {currentView === 'customers' && userProfile && activeBusiness && (
          <CustomersView
            userProfile={userProfile}
            businessId={activeBusiness.id}
          />
        )}

      </main>

    </div>
  );
}
