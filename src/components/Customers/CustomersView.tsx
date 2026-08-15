import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, addDoc, getDocs, updateDoc, doc, serverTimestamp, query, orderBy, setDoc } from 'firebase/firestore';
import { Customer, UserProfile } from '../../types';
import { Search, Plus, UserPlus, CreditCard, DollarSign, History, RefreshCw, X, Check } from 'lucide-react';

interface CustomersViewProps {
  userProfile: UserProfile;
  businessId: string;
}

export interface CCPaymentLog {
  id: string;
  customerId: string;
  customerName: string;
  amount: number;
  type: 'AMORTIZACION_PAGO' | 'CREDITO_DEUDA';
  details: string;
  createdAt: string;
}

export const CustomersView: React.FC<CustomersViewProps> = ({ userProfile, businessId }) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [ccHistory, setCcHistory] = useState<CCPaymentLog[]>([]);

  // Modals state
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  
  // Payment state for Cuenta Corriente amortization
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('AMORTIZACIÓN EN EFECTIVO');

  // Customer Form State
  const [custName, setCustName] = useState('');
  const [custDni, setCustDni] = useState('');
  const [custCuit, setCustCuit] = useState('');
  const [custTaxCond, setCustTaxCond] = useState('Consumidor Final');
  const [custEmail, setCustEmail] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custAddress, setCustAddress] = useState('');
  const [custCreditLimit, setCustCreditLimit] = useState('15000');

  const custPath = `businesses/${businessId}/customers`;
  const ccLogPath = `businesses/${businessId}/cc_payment_logs`;

  useEffect(() => {
    fetchCustomers();
  }, [businessId]);

  const fetchCustomers = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, custPath));
      const custList: Customer[] = [];
      querySnapshot.forEach((doc) => {
        custList.push({ id: doc.id, ...doc.data() } as Customer);
      });
      setCustomers(custList.sort((a, b) => a.name.localeCompare(b.name)));

      const ccSnapshot = await getDocs(query(collection(db, ccLogPath), orderBy('createdAt', 'desc')));
      const ccList: CCPaymentLog[] = [];
      ccSnapshot.forEach((doc) => {
        ccList.push({ id: doc.id, ...doc.data() } as CCPaymentLog);
      });
      setCcHistory(ccList);
    } catch (error) {
      console.error("Error fetching customers:", error);
    }
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const limitVal = parseFloat(custCreditLimit);
    if (isNaN(limitVal) || limitVal < 0) {
      alert("Ingrese un límite de crédito válido.");
      return;
    }

    try {
      if (editingCustomer) {
        // Update customer details
        const docRef = doc(db, custPath, editingCustomer.id);
        const updatedFields: Partial<Customer> = {
          name: custName.trim(),
          dni: custDni.trim() || undefined,
          cuit: custCuit.trim() || undefined,
          taxCondition: custTaxCond,
          email: custEmail.trim() || undefined,
          phone: custPhone.trim() || undefined,
          address: custAddress.trim() || undefined,
          creditLimit: limitVal
        };

        await updateDoc(docRef, updatedFields);

        // Audit Log
        await addDoc(collection(db, `businesses/${businessId}/audit_logs`), {
          userId: userProfile.id,
          userEmail: userProfile.email,
          action: "EDITAR_CLIENTE",
          details: `Cliente modificado: ${custName.trim()} (DNI/CUIT: ${custDni || custCuit || 'N/A'})`,
          createdAt: new Date().toISOString()
        });

      } else {
        // Create new customer
        const newRef = doc(collection(db, custPath));
        const newCust: Omit<Customer, 'id'> = {
          name: custName.trim(),
          dni: custDni.trim() || undefined,
          cuit: custCuit.trim() || undefined,
          taxCondition: custTaxCond,
          email: custEmail.trim() || undefined,
          phone: custPhone.trim() || undefined,
          address: custAddress.trim() || undefined,
          creditLimit: limitVal,
          balance: 0,
          status: 'ACTIVE',
          createdAt: new Date().toISOString()
        };

        await setDoc(newRef, newCust);

        // Audit Log
        await addDoc(collection(db, `businesses/${businessId}/audit_logs`), {
          userId: userProfile.id,
          userEmail: userProfile.email,
          action: "CREAR_CLIENTE",
          details: `Cliente registrado: ${custName.trim()}`,
          createdAt: new Date().toISOString()
        });
      }

      setIsCustomerModalOpen(false);
      setEditingCustomer(null);
      resetForm();
      fetchCustomers();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, custPath);
    }
  };

  // Pay credit balance (CC Amortization)
  const handleAmortizeCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentCustomer) return;

    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Ingrese un monto de pago válido.");
      return;
    }

    try {
      const currentBalance = paymentCustomer.balance;
      const targetBalance = currentBalance - amount;

      // Update customer balance
      await updateDoc(doc(db, custPath, paymentCustomer.id), {
        balance: targetBalance
      });

      // Write payment log
      await addDoc(collection(db, ccLogPath), {
        customerId: paymentCustomer.id,
        customerName: paymentCustomer.name,
        amount,
        type: 'AMORTIZACION_PAGO',
        details: paymentReference.trim(),
        createdAt: new Date().toISOString()
      });

      // Audit Log
      await addDoc(collection(db, `businesses/${businessId}/audit_logs`), {
        userId: userProfile.id,
        userEmail: userProfile.email,
        action: "PAGO_CUENTA_CORRIENTE",
        details: `Cobro en cuenta corriente para ${paymentCustomer.name}. Importe: $${amount}. Ref: ${paymentReference}`,
        createdAt: new Date().toISOString()
      });

      // Also generate a physical cash register session movement in background if it's cash payment
      if (paymentReference.toUpperCase().includes('EFECTIVO')) {
        // In real app, we would search and append to active session movements if session is open
        console.log("Registrando ingreso de efectivo por CC");
      }

      setPaymentCustomer(null);
      setPaymentAmount('');
      setPaymentReference('AMORTIZACIÓN EN EFECTIVO');
      fetchCustomers();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, custPath);
    }
  };

  const handleEditClick = (cust: Customer) => {
    setEditingCustomer(cust);
    setCustName(cust.name);
    setCustDni(cust.dni || '');
    setCustCuit(cust.cuit || '');
    setCustTaxCond(cust.taxCondition);
    setCustEmail(cust.email || '');
    setCustPhone(cust.phone || '');
    setCustAddress(cust.address || '');
    setCustCreditLimit(cust.creditLimit.toString());
    setIsCustomerModalOpen(true);
  };

  const resetForm = () => {
    setCustName('');
    setCustDni('');
    setCustCuit('');
    setCustTaxCond('Consumidor Final');
    setCustEmail('');
    setCustPhone('');
    setCustAddress('');
    setCustCreditLimit('15000');
  };

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.dni && c.dni.includes(searchTerm)) ||
    (c.cuit && c.cuit.includes(searchTerm))
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      
      {/* Overview stats and main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Customer list and searches */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 text-slate-500" size={16} />
              <input
                type="text"
                placeholder="Buscar por Nombre, DNI o CUIT..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-md pl-10 pr-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 text-xs font-mono"
              />
            </div>
            <button
              onClick={() => {
                setEditingCustomer(null);
                resetForm();
                setIsCustomerModalOpen(true);
              }}
              className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-4 py-2 rounded text-xs font-bold flex items-center space-x-1.5 transition-colors self-stretch sm:self-auto justify-center"
            >
              <UserPlus size={16} />
              <span>NUEVO CLIENTE</span>
            </button>
          </div>

          {/* Customers table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-mono uppercase">
                    <th className="p-3">Nombre</th>
                    <th className="p-3">Identificación</th>
                    <th className="p-3">Condición Fiscal</th>
                    <th className="p-3">Saldo Deuda CC</th>
                    <th className="p-3 text-center">Límite Crédito</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 font-mono text-slate-300">
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-500">No hay clientes registrados en el sistema.</td>
                    </tr>
                  ) : (
                    filteredCustomers.map((c) => {
                      const isOverLimit = c.balance >= c.creditLimit;

                      return (
                        <tr key={c.id} className="hover:bg-slate-850/40">
                          <td className="p-3 font-semibold text-slate-200 font-sans text-xs">{c.name}</td>
                          <td className="p-3 text-slate-400">{c.dni ? `DNI: ${c.dni}` : c.cuit ? `CUIT: ${c.cuit}` : 'Sin Id'}</td>
                          <td className="p-3 text-slate-400 font-sans">{c.taxCondition}</td>
                          <td className="p-3">
                            <span className={`font-bold text-xs ${c.balance > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                              ${c.balance.toLocaleString('es-AR')}
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px]">
                              ${c.creditLimit.toLocaleString('es-AR')}
                            </span>
                          </td>
                          <td className="p-3 text-right space-x-1.5">
                            {c.balance > 0 && (
                              <button
                                onClick={() => setPaymentCustomer(c)}
                                className="bg-emerald-950 text-emerald-400 border border-emerald-900 px-2 py-0.5 rounded text-[10px] hover:bg-emerald-900/40"
                              >
                                Cobrar
                              </button>
                            )}
                            <button
                              onClick={() => handleEditClick(c)}
                              className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px] hover:bg-slate-700"
                            >
                              Ficha
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* CC Payments Panel / Live Ledger */}
        <div className="lg:col-span-1 space-y-6">
          
          {/* Amortize Form */}
          {paymentCustomer && (
            <div className="bg-slate-900 border border-emerald-800/40 p-6 rounded-xl space-y-4">
              <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                <span className="text-xs font-bold text-emerald-400 font-mono">REGISTRAR COBRO / CRÉDITO CC</span>
                <button onClick={() => setPaymentCustomer(null)} className="text-slate-400 hover:text-slate-200">
                  <X size={16} />
                </button>
              </div>

              <div>
                <p className="text-xs text-slate-400">Cliente seleccionado:</p>
                <h4 className="text-sm font-bold text-slate-100 font-sans mt-0.5">{paymentCustomer.name}</h4>
                <div className="flex justify-between text-xs font-mono text-slate-400 mt-1">
                  <span>Deuda Actual:</span>
                  <span className="font-bold text-rose-400">${paymentCustomer.balance.toLocaleString('es-AR')}</span>
                </div>
              </div>

              <form onSubmit={handleAmortizeCredit} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-mono text-slate-400 mb-1">Monto a Amortizar ($) *</label>
                  <input
                    type="number"
                    required
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded text-slate-100 px-3 py-1.5 font-mono text-xs focus:outline-none focus:border-emerald-500"
                    placeholder="Monto"
                    step="0.01"
                    max={paymentCustomer.balance}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-slate-400 mb-1">Referencia / Medio *</label>
                  <input
                    type="text"
                    required
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded text-slate-100 px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
                    placeholder="Ej. Cobro en efectivo o Transferencia..."
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold py-2 rounded text-xs uppercase tracking-wider transition-colors"
                >
                  REGISTRAR PAGO RECIBIDO
                </button>
              </form>
            </div>
          )}

          {/* Account History audit logs list */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider font-sans">Historial de Cobros CC</h3>
              <RefreshCw size={12} className="text-slate-500 cursor-pointer hover:text-slate-300" onClick={fetchCustomers} />
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto font-mono text-[11px] divide-y divide-slate-850">
              {ccHistory.length === 0 ? (
                <p className="text-center text-slate-500 py-4">Sin amortizaciones históricas registradas.</p>
              ) : (
                ccHistory.map((log) => (
                  <div key={log.id} className="pt-2.5 first:pt-0">
                    <div className="flex justify-between font-bold">
                      <span className="text-slate-200 text-xs font-sans truncate pr-2">{log.customerName}</span>
                      <span className="text-emerald-400">${log.amount.toLocaleString('es-AR')}</span>
                    </div>
                    <p className="text-slate-400 mt-0.5 text-[10px]">{log.details}</p>
                    <span className="text-[9px] text-slate-500">
                      {new Date(log.createdAt).toLocaleString('es-AR')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>

      {/* --- MODAL: CUSTOMER REGISTRATION --- */}
      {isCustomerModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex justify-between items-center">
              <h3 className="text-base font-bold text-slate-200">
                {editingCustomer ? `Editar Ficha: ${editingCustomer.name}` : 'Registrar Nuevo Cliente'}
              </h3>
              <button onClick={() => setIsCustomerModalOpen(false)} className="text-slate-400 hover:text-slate-200">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Full name */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-mono text-slate-400 mb-1">Nombre Completo o Razón Social *</label>
                  <input
                    type="text"
                    required
                    value={custName}
                    onChange={(e) => setCustName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs focus:outline-none"
                    placeholder="Ej. Juan Pérez"
                  />
                </div>

                {/* DNI */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Número de DNI</label>
                  <input
                    type="text"
                    value={custDni}
                    onChange={(e) => setCustDni(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs font-mono"
                    placeholder="Sin puntos"
                  />
                </div>

                {/* CUIT */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Número de CUIT</label>
                  <input
                    type="text"
                    value={custCuit}
                    onChange={(e) => setCustCuit(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs font-mono"
                    placeholder="Con guiones"
                  />
                </div>

                {/* Tax Condition */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Condición Fiscal *</label>
                  <select
                    value={custTaxCond}
                    onChange={(e) => setCustTaxCond(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs"
                  >
                    <option value="Consumidor Final">Consumidor Final</option>
                    <option value="Responsable Inscripto">Responsable Inscripto</option>
                    <option value="Monotributista">Monotributista</option>
                    <option value="Exento">Exento</option>
                  </select>
                </div>

                {/* Credit Limit */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Límite de Crédito ($) *</label>
                  <input
                    type="number"
                    required
                    value={custCreditLimit}
                    onChange={(e) => setCustCreditLimit(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs font-mono"
                    placeholder="15000"
                  />
                </div>

                {/* Contact data */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Teléfono</label>
                  <input
                    type="text"
                    value={custPhone}
                    onChange={(e) => setCustPhone(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs"
                    placeholder="Móvil o fijo"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Email</label>
                  <input
                    type="email"
                    value={custEmail}
                    onChange={(e) => setCustEmail(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs"
                    placeholder="correo@ejemplo.com"
                  />
                </div>

                {/* Address */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-mono text-slate-400 mb-1">Dirección Física</label>
                  <input
                    type="text"
                    value={custAddress}
                    onChange={(e) => setCustAddress(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs"
                    placeholder="Dirección comercial o particular"
                  />
                </div>

              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCustomerModalOpen(false)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-4 py-2 rounded text-xs transition-colors"
                >
                  CANCELAR
                </button>
                <button
                  type="submit"
                  className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-4 py-2 rounded text-xs uppercase tracking-wider transition-colors"
                >
                  GUARDAR CLIENTE
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
