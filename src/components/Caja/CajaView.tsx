import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, addDoc, getDocs, updateDoc, doc, serverTimestamp, query, orderBy, limit, setDoc } from 'firebase/firestore';
import { CashSession, CashMovement, UserProfile, CashSessionStatus } from '../../types';
import { DollarSign, ArrowDownRight, ArrowUpLeft, Calendar, User, Clock, CheckCircle, AlertTriangle } from 'lucide-react';

interface CajaViewProps {
  userProfile: UserProfile;
  businessId: string;
  activeSession: CashSession | null;
  onSessionOpened: (session: CashSession) => void;
  onSessionClosed: () => void;
}

export const CajaView: React.FC<CajaViewProps> = ({
  userProfile,
  businessId,
  activeSession,
  onSessionOpened,
  onSessionClosed
}) => {
  // Opening Cash state
  const [initialCash, setInitialCash] = useState<string>('5000');
  
  // Movement State
  const [movementType, setMovementType] = useState<'INGRESAR' | 'RETIRAR'>('INGRESAR');
  const [movementAmount, setMovementAmount] = useState<string>('');
  const [movementReason, setMovementReason] = useState<string>('');
  const [movements, setMovements] = useState<CashMovement[]>([]);

  // Closing State
  const [declaredCash, setDeclaredCash] = useState<string>('');
  const [closingMessage, setClosingMessage] = useState<string | null>(null);

  // History State
  const [sessionHistory, setSessionHistory] = useState<CashSession[]>([]);

  const sessionPath = `businesses/${businessId}/branches/${userProfile.branchId}/cash_sessions`;

  // Fetch recent sessions and current session movements
  useEffect(() => {
    fetchHistory();
  }, [businessId, activeSession]);

  const fetchHistory = async () => {
    try {
      const q = query(collection(db, sessionPath), orderBy('openedAt', 'desc'), limit(15));
      const querySnapshot = await getDocs(q);
      const sessions: CashSession[] = [];
      querySnapshot.forEach((doc) => {
        sessions.push({ id: doc.id, ...doc.data() } as CashSession);
      });
      setSessionHistory(sessions);

      if (activeSession) {
        // Fetch movements for current session
        const mSnapshot = await getDocs(collection(db, `${sessionPath}/${activeSession.id}/movements`));
        const movList: CashMovement[] = [];
        mSnapshot.forEach((doc) => {
          movList.push({ id: doc.id, ...doc.data() } as CashMovement);
        });
        setMovements(movList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      }
    } catch (error) {
      console.error("Error fetching history:", error);
    }
  };

  const handleOpenCaja = async (e: React.FormEvent) => {
    e.preventDefault();
    const cashValue = parseFloat(initialCash);
    if (isNaN(cashValue) || cashValue < 0) {
      alert("Por favor ingrese un monto válido.");
      return;
    }

    try {
      const newSessionRef = doc(collection(db, sessionPath));
      const sessionData: Omit<CashSession, 'id'> = {
        registerId: 'REG_MAIN_01',
        branchId: userProfile.branchId,
        openedBy: userProfile.id,
        openedByName: userProfile.name,
        openedAt: new Date().toISOString(),
        initialCash: cashValue,
        expectedCash: cashValue,
        status: CashSessionStatus.OPEN
      };

      await setDoc(newSessionRef, sessionData);
      
      // Register initial audit log
      await addDoc(collection(db, `businesses/${businessId}/audit_logs`), {
        userId: userProfile.id,
        userEmail: userProfile.email,
        action: "APERTURA_CAJA",
        details: `Caja abierta con un monto inicial de $${cashValue}`,
        createdAt: new Date().toISOString()
      });

      onSessionOpened({ id: newSessionRef.id, ...sessionData });
      setClosingMessage(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, sessionPath);
    }
  };

  const handleAddMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) return;

    const amount = parseFloat(movementAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("Ingrese un monto válido de movimiento.");
      return;
    }

    if (!movementReason.trim()) {
      alert("Debe especificar el motivo del movimiento.");
      return;
    }

    try {
      const movePath = `${sessionPath}/${activeSession.id}/movements`;
      const movData: Omit<CashMovement, 'id'> = {
        sessionId: activeSession.id,
        type: movementType,
        amount,
        reason: movementReason.trim(),
        userId: userProfile.id,
        userName: userProfile.name,
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, movePath), movData);

      // Update cash expected inside session
      const updatedExpected = activeSession.expectedCash + (movementType === 'INGRESAR' ? amount : -amount);
      await updateDoc(doc(db, sessionPath, activeSession.id), {
        expectedCash: updatedExpected
      });

      // Audit Log
      await addDoc(collection(db, `businesses/${businessId}/audit_logs`), {
        userId: userProfile.id,
        userEmail: userProfile.email,
        action: movementType === 'INGRESAR' ? "INGRESO_CAJA" : "RETIRO_CAJA",
        details: `${movementType === 'INGRESAR' ? 'Ingreso' : 'Retiro'} de $${amount}. Motivo: ${movementReason}`,
        createdAt: new Date().toISOString()
      });

      // Refresh local active session
      onSessionOpened({
        ...activeSession,
        expectedCash: updatedExpected
      });

      setMovementAmount('');
      setMovementReason('');
      fetchHistory();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, sessionPath);
    }
  };

  const handleCloseCaja = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession) return;

    const declaredValue = parseFloat(declaredCash);
    if (isNaN(declaredValue) || declaredValue < 0) {
      alert("Ingrese un monto declarado válido.");
      return;
    }

    const diff = declaredValue - activeSession.expectedCash;

    try {
      await updateDoc(doc(db, sessionPath, activeSession.id), {
        closedAt: new Date().toISOString(),
        declaredCash: declaredValue,
        difference: diff,
        status: CashSessionStatus.CLOSED
      });

      // Update cash register status to closed
      const registerDocRef = doc(db, `businesses/${businessId}/branches/${userProfile.branchId}/cash_registers`, 'REG_MAIN_01');
      await updateDoc(registerDocRef, { status: 'CLOSED' });

      // Audit
      await addDoc(collection(db, `businesses/${businessId}/audit_logs`), {
        userId: userProfile.id,
        userEmail: userProfile.email,
        action: "CIERRE_CAJA",
        details: `Caja cerrada. Esperado: $${activeSession.expectedCash}, Declarado: $${declaredValue}, Diferencia: $${diff}`,
        createdAt: new Date().toISOString()
      });

      onSessionClosed();
      setDeclaredCash('');
      setClosingMessage(`¡Caja cerrada correctamente! Diferencia registrada: $${diff.toLocaleString('es-AR')}`);
      fetchHistory();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, sessionPath);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Messages */}
      {closingMessage && (
        <div className="mb-6 p-4 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-lg flex items-center space-x-2">
          <CheckCircle className="text-emerald-500" size={20} />
          <span className="font-medium font-mono text-sm">{closingMessage}</span>
        </div>
      )}

      {!activeSession ? (
        /* IF CAJA IS CLOSED */
        <div className="max-w-md mx-auto bg-slate-900 border border-slate-800 p-8 rounded-xl shadow-lg">
          <div className="text-center mb-6">
            <div className="inline-flex p-4 bg-rose-500/10 text-rose-400 rounded-full mb-3">
              <AlertTriangle size={32} />
            </div>
            <h2 className="text-xl font-bold text-slate-100 font-sans">Apertura de Caja diaria</h2>
            <p className="text-sm text-slate-400 font-mono mt-1">La caja está actualmente cerrada para este usuario.</p>
          </div>

          <form onSubmit={handleOpenCaja} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Efectivo Inicial en Caja ($)</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-mono">$</span>
                <input
                  type="number"
                  required
                  value={initialCash}
                  onChange={(e) => setInitialCash(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 pl-8 pr-4 py-3 rounded-md font-mono focus:outline-none focus:border-emerald-500 text-lg"
                  placeholder="0.00"
                  step="0.01"
                />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Sugerido para cambio / caja chica al iniciar el turno.</p>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-sm tracking-wider uppercase rounded-md shadow-md transition-colors"
            >
              ABRIR CAJA (F4)
            </button>
          </form>
        </div>
      ) : (
        /* IF CAJA IS OPEN */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Active Status & Closing Panel */}
          <div className="lg:col-span-1 bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-6">
            <div>
              <span className="text-emerald-400 text-[10px] font-bold font-mono tracking-widest uppercase bg-emerald-400/10 px-2.5 py-1 rounded-full">
                SESIÓN DE CAJA ACTIVA
              </span>
              <h2 className="text-2xl font-bold text-slate-100 font-sans mt-3">Arqueo en Tiempo Real</h2>
              <p className="text-xs text-slate-400 font-mono mt-0.5">Control de valores en la terminal.</p>
            </div>

            {/* Core Values */}
            <div className="bg-slate-950 border border-slate-850 p-4 rounded-lg space-y-3">
              <div className="flex justify-between items-center text-xs text-slate-400 font-mono">
                <span>Efectivo Inicial:</span>
                <span className="text-slate-200">${activeSession.initialCash.toLocaleString('es-AR')}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-slate-400 font-mono">
                <span>Ventas registradas:</span>
                <span className="text-slate-200">
                  ${(activeSession.expectedCash - activeSession.initialCash).toLocaleString('es-AR')}
                </span>
              </div>
              <div className="h-px bg-slate-800 my-2" />
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider font-mono">Efectivo Esperado:</span>
                <span className="text-xl font-bold text-slate-100 font-mono">
                  ${activeSession.expectedCash.toLocaleString('es-AR')}
                </span>
              </div>
            </div>

            {/* Close Caja Form */}
            <form onSubmit={handleCloseCaja} className="space-y-4 pt-4 border-t border-slate-800">
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-sans">Cerrar Caja</h3>
              
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2 font-mono">Efectivo Declarado en Caja ($)</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 font-mono">$</span>
                  <input
                    type="number"
                    required
                    value={declaredCash}
                    onChange={(e) => setDeclaredCash(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 pl-8 pr-4 py-2.5 rounded font-mono focus:outline-none focus:border-emerald-500"
                    placeholder="Cuente el efectivo físico..."
                    step="0.01"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs tracking-wider uppercase rounded shadow transition-colors"
              >
                EFECTUAR ARQUEO Y CERRAR CAJA
              </button>
            </form>
          </div>

          {/* Caja Movements panel (Ingresos/Egresos) */}
          <div className="lg:col-span-2 space-y-6">
            
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
              <h3 className="text-lg font-bold text-slate-100 font-sans mb-4">Ingresos / Retiros de Efectivo</h3>
              
              <form onSubmit={handleAddMovement} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase">Operación</label>
                  <select
                    value={movementType}
                    onChange={(e) => setMovementType(e.target.value as 'INGRESAR' | 'RETIRAR')}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2 rounded focus:outline-none focus:border-emerald-500 text-xs font-mono"
                  >
                    <option value="INGRESAR">Ingreso (+)</option>
                    <option value="RETIRAR">Retiro / Pago (-)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase">Monto ($)</label>
                  <input
                    type="number"
                    required
                    value={movementAmount}
                    onChange={(e) => setMovementAmount(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2 rounded font-mono focus:outline-none focus:border-emerald-500 text-xs"
                    placeholder="Monto"
                    step="0.01"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-mono text-slate-400 mb-1.5 uppercase">Motivo / Detalle</label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      required
                      value={movementReason}
                      onChange={(e) => setMovementReason(e.target.value)}
                      className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 px-3 py-2 rounded focus:outline-none focus:border-emerald-500 text-xs"
                      placeholder="Ej. Cambio extra o Pago a proveedor..."
                    />
                    <button
                      type="submit"
                      className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-4 py-2 rounded text-xs tracking-wider uppercase transition-colors"
                    >
                      REGISTRAR
                    </button>
                  </div>
                </div>
              </form>

              {/* Recent Movements List */}
              <div className="mt-6">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 font-mono">Movimientos de la Sesión</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono">
                        <th className="py-2">Hora</th>
                        <th className="py-2">Tipo</th>
                        <th className="py-2">Monto</th>
                        <th className="py-2">Motivo</th>
                        <th className="py-2">Registrado por</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850 font-mono">
                      {movements.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-slate-500">Sin movimientos registrados en este turno.</td>
                        </tr>
                      ) : (
                        movements.map((m) => (
                          <tr key={m.id} className="text-slate-300">
                            <td className="py-2">{new Date(m.createdAt).toLocaleTimeString('es-AR')}</td>
                            <td className="py-2">
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                m.type === 'INGRESAR' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
                              }`}>
                                {m.type}
                              </span>
                            </td>
                            <td className={`py-2 font-bold ${m.type === 'INGRESAR' ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {m.type === 'INGRESAR' ? '+' : '-'}${m.amount.toLocaleString('es-AR')}
                            </td>
                            <td className="py-2 text-slate-400">{m.reason}</td>
                            <td className="py-2 text-slate-400">{m.userName || 'Cajero'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* History of sessions */}
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
              <h3 className="text-sm font-bold text-slate-100 font-sans uppercase tracking-wider mb-4">Historial de Turnos de Caja</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono">
                      <th className="py-2">Apertura</th>
                      <th className="py-2">Cierre</th>
                      <th className="py-2">Iniciado por</th>
                      <th className="py-2">Efectivo Inicial</th>
                      <th className="py-2">Efectivo Final</th>
                      <th className="py-2">Diferencia</th>
                      <th className="py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 font-mono text-slate-300">
                    {sessionHistory.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-4 text-center text-slate-500">No se encontraron sesiones registradas en la base de datos.</td>
                      </tr>
                    ) : (
                      sessionHistory.map((s) => (
                        <tr key={s.id}>
                          <td className="py-2.5">
                            {new Date(s.openedAt).toLocaleDateString('es-AR')} {new Date(s.openedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-2.5">
                            {s.closedAt ? (
                              <span>
                                {new Date(s.closedAt).toLocaleDateString('es-AR')} {new Date(s.closedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="py-2.5">{s.openedByName || 'Cajero'}</td>
                          <td className="py-2.5">${s.initialCash.toLocaleString('es-AR')}</td>
                          <td className="py-2.5">
                            {s.declaredCash !== undefined ? `$${s.declaredCash.toLocaleString('es-AR')}` : `$${s.expectedCash.toLocaleString('es-AR')}`}
                          </td>
                          <td className="py-2.5">
                            {s.difference !== undefined ? (
                              <span className={`font-bold ${s.difference === 0 ? 'text-emerald-400' : s.difference > 0 ? 'text-amber-400' : 'text-rose-400'}`}>
                                {s.difference > 0 ? '+' : ''}${s.difference.toLocaleString('es-AR')}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="py-2.5">
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold ${
                              s.status === 'OPEN' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-850 text-slate-400'
                            }`}>
                              {s.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};
