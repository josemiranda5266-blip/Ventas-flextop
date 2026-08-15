import React from 'react';
import { LogOut, User, Store, Shield, Circle, RefreshCw, Layers } from 'lucide-react';
import { UserProfile, CashSession, Business, Branch } from '../../types';

interface NavbarProps {
  userProfile: UserProfile | null;
  activeBusiness: Business | null;
  activeBranch: Branch | null;
  activeSession: CashSession | null;
  isOnline: boolean;
  onLogout: () => void;
  onChangeView: (view: 'pos' | 'stock' | 'caja' | 'customers') => void;
  currentView: 'pos' | 'stock' | 'caja' | 'customers';
}

export const Navbar: React.FC<NavbarProps> = ({
  userProfile,
  activeBusiness,
  activeBranch,
  activeSession,
  isOnline,
  onLogout,
  onChangeView,
  currentView
}) => {
  return (
    <header className="bg-slate-900 text-slate-100 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center space-x-3">
            <div className="bg-emerald-500 text-slate-950 p-2 rounded-lg font-bold flex items-center justify-center">
              <Layers size={20} />
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-wider text-emerald-400">POS ARGENTINA</span>
              <p className="text-[10px] text-slate-400 font-mono tracking-widest leading-none mt-0.5">SISTEMA COMERCIAL INDEPENDIENTE</p>
            </div>
          </div>

          {/* Core Navigation (Fase 1 Tabs) */}
          {userProfile && (
            <nav className="hidden md:flex space-x-1">
              <button
                onClick={() => onChangeView('pos')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'pos'
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                Punto de Venta
              </button>
              <button
                onClick={() => onChangeView('caja')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'caja'
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                Caja diaria
              </button>
              <button
                onClick={() => onChangeView('stock')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'stock'
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                Catálogo & Stock
              </button>
              <button
                onClick={() => onChangeView('customers')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  currentView === 'customers'
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                Clientes & CC
              </button>
            </nav>
          )}

          {/* System Status and Profile Details */}
          <div className="flex items-center space-x-4">
            {/* Online Indicator */}
            <div className="flex items-center space-x-1.5 bg-slate-800 px-2.5 py-1 rounded-full text-xs">
              <Circle size={10} className={isOnline ? "fill-emerald-400 text-emerald-400" : "fill-rose-500 text-rose-500"} />
              <span className="font-mono text-[11px] text-slate-300">{isOnline ? "CONECTADO" : "SIN CONEXIÓN"}</span>
            </div>

            {/* Session / Business Details */}
            {userProfile && (
              <div className="hidden lg:flex flex-col items-end text-xs font-mono text-slate-400 space-y-0.5 border-r border-slate-800 pr-4">
                <div className="flex items-center space-x-1 text-slate-200">
                  <Store size={12} className="text-emerald-400" />
                  <span className="font-semibold uppercase">{activeBusiness?.name || 'Comercio'}</span>
                  <span className="text-slate-500">|</span>
                  <span className="text-slate-300">{activeBranch?.name || 'Sucursal'}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Shield size={12} className="text-amber-400" />
                  <span className="text-slate-300">{userProfile.name}</span>
                  <span className="bg-slate-800 text-amber-400 px-1.5 py-0.2 rounded text-[9px] font-bold">
                    {userProfile.role}
                  </span>
                </div>
              </div>
            )}

            {/* Cashier state summary badge */}
            {activeSession ? (
              <div className="bg-emerald-950 text-emerald-300 border border-emerald-800 px-3 py-1 rounded text-xs font-mono hidden sm:block">
                CAJA ABIERTA: <span className="font-bold">${activeSession.expectedCash.toLocaleString('es-AR')}</span>
              </div>
            ) : (
              <div className="bg-rose-950 text-rose-300 border border-rose-800 px-3 py-1 rounded text-xs font-mono hidden sm:block">
                CAJA CERRADA
              </div>
            )}

            {/* Logout Button */}
            {userProfile && (
              <button
                onClick={onLogout}
                className="text-slate-400 hover:text-rose-400 p-2 rounded-full hover:bg-slate-800 transition-colors"
                title="Cerrar sesión"
              >
                <LogOut size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
