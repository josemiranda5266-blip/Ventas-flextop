import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { collection, addDoc, getDocs, updateDoc, doc, deleteDoc, query, orderBy, setDoc } from 'firebase/firestore';
import { Product, Category, StockMovement, StockMovementType, UserProfile } from '../../types';
import { Search, Plus, Edit2, Trash2, Tag, Layers, RefreshCw, AlertCircle, FileText, Check, X } from 'lucide-react';

interface StockViewProps {
  userProfile: UserProfile;
  businessId: string;
  onRefreshCaja?: () => void;
}

export const StockView: React.FC<StockViewProps> = ({ userProfile, businessId }) => {
  // Lists State
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);

  // Filter & Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [filterLowStock, setFilterLowStock] = useState(false);

  // Modals / Tab state
  const [activeTab, setActiveTab] = useState<'products' | 'categories' | 'kardex'>('products');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);

  // Form State - Product
  const [prodCode, setProdCode] = useState('');
  const [prodBarcode, setProdBarcode] = useState('');
  const [prodName, setProdName] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodCatId, setProdCatId] = useState('');
  const [prodCost, setProdCost] = useState('');
  const [prodPrice, setProdPrice] = useState('');
  const [prodTax, setProdTax] = useState('21'); // 21% default in Argentina
  const [prodStock, setProdStock] = useState('100');
  const [prodMinStock, setProdMinStock] = useState('10');
  const [prodMaxStock, setProdMaxStock] = useState('500');

  // Form State - Category
  const [newCatName, setNewCatName] = useState('');

  // Form State - Manual Stock Adjustment
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState('AJUSTE MANUAL DE INVENTARIO');

  const prodPath = `businesses/${businessId}/products`;
  const catPath = `businesses/${businessId}/categories`;
  const movePath = `businesses/${businessId}/stock_movements`;

  useEffect(() => {
    fetchData();
  }, [businessId]);

  const fetchData = async () => {
    try {
      // Fetch Categories
      const catSnapshot = await getDocs(collection(db, catPath));
      const catList: Category[] = [];
      catSnapshot.forEach((doc) => {
        catList.push({ id: doc.id, ...doc.data() } as Category);
      });
      setCategories(catList);
      if (catList.length > 0 && !prodCatId) {
        setProdCatId(catList[0].id);
      }

      // Fetch Products
      const prodSnapshot = await getDocs(collection(db, prodPath));
      const prodList: Product[] = [];
      prodSnapshot.forEach((doc) => {
        prodList.push({ id: doc.id, ...doc.data() } as Product);
      });
      setProducts(prodList.sort((a, b) => a.name.localeCompare(b.name)));

      // Fetch Stock Movements
      const movSnapshot = await getDocs(query(collection(db, movePath), orderBy('createdAt', 'desc')));
      const movList: StockMovement[] = [];
      movSnapshot.forEach((doc) => {
        movList.push({ id: doc.id, ...doc.data() } as StockMovement);
      });
      setMovements(movList);
    } catch (error) {
      console.error("Error fetching stock data:", error);
    }
  };

  // Create or Update Product
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const cost = parseFloat(prodCost);
    const price = parseFloat(prodPrice);
    const tax = parseFloat(prodTax);
    const stockVal = parseFloat(prodStock);
    const minStockVal = parseFloat(prodMinStock);
    const maxStockVal = parseFloat(prodMaxStock);

    if (isNaN(cost) || isNaN(price) || isNaN(stockVal)) {
      alert("Ingrese valores numéricos correctos para costo, precio y stock.");
      return;
    }

    const calculatedMargin = cost > 0 ? ((price - cost) / cost) * 100 : 0;

    try {
      if (editingProduct) {
        // Update product
        const prodDocRef = doc(db, prodPath, editingProduct.id);
        const updatedFields: Partial<Product> = {
          code: prodCode.trim(),
          barcode: prodBarcode.trim(),
          sku: prodCode.trim(),
          name: prodName.trim(),
          description: prodDesc.trim(),
          categoryId: prodCatId,
          costPrice: cost,
          salePrice: price,
          margin: calculatedMargin,
          taxRate: tax,
          stock: stockVal,
          minStock: minStockVal,
          maxStock: maxStockVal
        };

        await updateDoc(prodDocRef, updatedFields);

        // If stock changed manually, create a stock movement log
        if (stockVal !== editingProduct.stock) {
          const change = stockVal - editingProduct.stock;
          await addDoc(collection(db, movePath), {
            productId: editingProduct.id,
            productName: prodName.trim(),
            type: StockMovementType.AJUSTE,
            qtyPrevious: editingProduct.stock,
            qtyChange: change,
            qtyAfter: stockVal,
            reason: "Edición manual de ficha de producto",
            userId: userProfile.id,
            userName: userProfile.name,
            createdAt: new Date().toISOString()
          });
        }

        // Audit Log
        await addDoc(collection(db, `businesses/${businessId}/audit_logs`), {
          userId: userProfile.id,
          userEmail: userProfile.email,
          action: "EDITAR_PRODUCTO",
          details: `Producto modificado: ${prodName.trim()} (Código: ${prodCode.trim()})`,
          createdAt: new Date().toISOString()
        });

      } else {
        // Create Product
        const newProdRef = doc(collection(db, prodPath));
        const newProduct: Omit<Product, 'id'> = {
          code: prodCode.trim(),
          barcode: prodBarcode.trim(),
          sku: prodCode.trim(),
          name: prodName.trim(),
          description: prodDesc.trim(),
          categoryId: prodCatId,
          costPrice: cost,
          salePrice: price,
          margin: calculatedMargin,
          taxRate: tax,
          stock: stockVal,
          minStock: minStockVal,
          maxStock: maxStockVal,
          supplierId: '',
          status: 'ACTIVE',
          createdAt: new Date().toISOString()
        };

        await setDoc(newProdRef, newProduct);

        // Initial Kardex Log
        await addDoc(collection(db, movePath), {
          productId: newProdRef.id,
          productName: prodName.trim(),
          type: StockMovementType.ENTRADA,
          qtyPrevious: 0,
          qtyChange: stockVal,
          qtyAfter: stockVal,
          reason: "Carga inicial de producto",
          userId: userProfile.id,
          userName: userProfile.name,
          createdAt: new Date().toISOString()
        });

        // Audit Log
        await addDoc(collection(db, `businesses/${businessId}/audit_logs`), {
          userId: userProfile.id,
          userEmail: userProfile.email,
          action: "CREAR_PRODUCTO",
          details: `Producto creado: ${prodName.trim()} (Código: ${prodCode.trim()}). Stock inicial: ${stockVal}`,
          createdAt: new Date().toISOString()
        });
      }

      setIsProductModalOpen(false);
      setEditingProduct(null);
      resetForm();
      fetchData();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, prodPath);
    }
  };

  // Add Category
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;

    try {
      const newCatRef = doc(collection(db, catPath));
      await setDoc(newCatRef, {
        name: newCatName.trim(),
        createdAt: new Date().toISOString()
      });

      // Audit Log
      await addDoc(collection(db, `businesses/${businessId}/audit_logs`), {
        userId: userProfile.id,
        userEmail: userProfile.email,
        action: "CREAR_CATEGORIA",
        details: `Categoría creada: ${newCatName.trim()}`,
        createdAt: new Date().toISOString()
      });

      setNewCatName('');
      fetchData();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, catPath);
    }
  };

  // Adjust stock via fast inline adjustment form
  const handleQuickAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustProduct) return;

    const change = parseFloat(adjustQty);
    if (isNaN(change) || change === 0) {
      alert("Ingrese una cantidad de ajuste válida (positiva para entradas, negativa para salidas).");
      return;
    }

    try {
      const currentStock = adjustProduct.stock;
      const targetStock = currentStock + change;

      if (targetStock < 0) {
        alert("El stock resultante no puede ser menor a cero.");
        return;
      }

      await updateDoc(doc(db, prodPath, adjustProduct.id), {
        stock: targetStock
      });

      // Stock Movement Log
      await addDoc(collection(db, movePath), {
        productId: adjustProduct.id,
        productName: adjustProduct.name,
        type: change > 0 ? StockMovementType.ENTRADA : StockMovementType.SALIDA,
        qtyPrevious: currentStock,
        qtyChange: change,
        qtyAfter: targetStock,
        reason: adjustReason.trim(),
        userId: userProfile.id,
        userName: userProfile.name,
        createdAt: new Date().toISOString()
      });

      // Audit Log
      await addDoc(collection(db, `businesses/${businessId}/audit_logs`), {
        userId: userProfile.id,
        userEmail: userProfile.email,
        action: "AJUSTE_STOCK",
        details: `Ajuste manual para ${adjustProduct.name}. Variación: ${change > 0 ? '+' : ''}${change}. Razón: ${adjustReason}`,
        createdAt: new Date().toISOString()
      });

      setAdjustProduct(null);
      setAdjustQty('');
      setAdjustReason('AJUSTE MANUAL DE INVENTARIO');
      fetchData();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, prodPath);
    }
  };

  const handleEditProductClick = (product: Product) => {
    setEditingProduct(product);
    setProdCode(product.code);
    setProdBarcode(product.barcode || '');
    setProdName(product.name);
    setProdDesc(product.description || '');
    setProdCatId(product.categoryId);
    setProdCost(product.costPrice.toString());
    setProdPrice(product.salePrice.toString());
    setProdTax(product.taxRate.toString());
    setProdStock(product.stock.toString());
    setProdMinStock(product.minStock.toString());
    setProdMaxStock(product.maxStock.toString());
    setIsProductModalOpen(true);
  };

  const handleToggleProductStatus = async (product: Product) => {
    const nextStatus = product.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await updateDoc(doc(db, prodPath, product.id), {
        status: nextStatus
      });
      fetchData();
    } catch (error) {
      console.error(error);
    }
  };

  const resetForm = () => {
    setProdCode('');
    setProdBarcode('');
    setProdName('');
    setProdDesc('');
    setProdCatId(categories[0]?.id || '');
    setProdCost('');
    setProdPrice('');
    setProdTax('21');
    setProdStock('100');
    setProdMinStock('10');
    setProdMaxStock('500');
  };

  // Filter products locally based on Search, Category, and Low Stock filter
  const filteredProducts = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          p.code.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          p.barcode.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = selectedCategory === 'ALL' || p.categoryId === selectedCategory;
    const matchesLowStock = !filterLowStock || p.stock <= p.minStock;

    return matchesSearch && matchesCategory && matchesLowStock;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Navigation Tabs for stock module */}
      <div className="border-b border-slate-800 flex justify-between items-center mb-6">
        <div className="flex space-x-2">
          <button
            onClick={() => setActiveTab('products')}
            className={`pb-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'products' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Fichas de Productos
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            className={`pb-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'categories' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Categorías
          </button>
          <button
            onClick={() => setActiveTab('kardex')}
            className={`pb-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'kardex' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Movimientos (Kardex)
          </button>
        </div>

        <button
          onClick={() => {
            fetchData();
          }}
          className="text-slate-400 hover:text-slate-200 p-2 rounded-full hover:bg-slate-800 transition-colors"
          title="Actualizar datos"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* --- TAB: PRODUCTS --- */}
      {activeTab === 'products' && (
        <div className="space-y-6">
          
          {/* Action Bar */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl items-center">
            
            {/* Search Input */}
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-2.5 text-slate-500" size={16} />
              <input
                type="text"
                placeholder="Buscar por Nombre, Código Interno o Código de Barras..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-md pl-10 pr-4 py-2 text-slate-200 focus:outline-none focus:border-emerald-500 text-xs font-mono"
              />
            </div>

            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-emerald-500"
            >
              <option value="ALL">Todas las Categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {/* Quick action buttons */}
            <div className="flex space-x-2 justify-end">
              <button
                onClick={() => setFilterLowStock(!filterLowStock)}
                className={`flex-1 px-3 py-2 rounded text-xs font-bold font-mono transition-colors border ${
                  filterLowStock 
                    ? 'bg-rose-950/40 text-rose-400 border-rose-800' 
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
              >
                {filterLowStock ? 'Bajo Stock Activo' : 'Filtrar Bajo Stock'}
              </button>
              <button
                onClick={() => {
                  setEditingProduct(null);
                  resetForm();
                  setIsProductModalOpen(true);
                }}
                className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 px-3 py-2 rounded text-xs font-bold flex items-center space-x-1.5 transition-colors"
              >
                <Plus size={16} />
                <span>NUEVO</span>
              </button>
            </div>
          </div>

          {/* Quick Stock Adjust Panel (if clicked) */}
          {adjustProduct && (
            <div className="p-4 bg-slate-900 border border-amber-800/40 rounded-xl">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold text-amber-400 font-mono">AJUSTAR INVENTARIO RÁPIDO: {adjustProduct.name}</span>
                <button onClick={() => setAdjustProduct(null)} className="text-slate-400 hover:text-slate-200">
                  <X size={16} />
                </button>
              </div>
              <form onSubmit={handleQuickAdjust} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="block text-[11px] font-mono text-slate-400 mb-1">Stock Actual:</label>
                  <div className="bg-slate-850 border border-slate-750 rounded text-slate-300 px-3 py-1.5 font-mono text-xs">
                    {adjustProduct.stock} unidades
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-slate-400 mb-1">Cantidad a Variar (+ o -):</label>
                  <input
                    type="number"
                    required
                    value={adjustQty}
                    onChange={(e) => setAdjustQty(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded text-slate-100 px-3 py-1.5 font-mono text-xs focus:outline-none focus:border-amber-500"
                    placeholder="Ej. 10 o -5"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-slate-400 mb-1">Motivo:</label>
                  <input
                    type="text"
                    required
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded text-slate-100 px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500"
                    placeholder="Detalle..."
                  />
                </div>
                <button
                  type="submit"
                  className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-1.5 rounded text-xs transition-colors"
                >
                  ACTUALIZAR STOCK
                </button>
              </form>
            </div>
          )}

          {/* Products Grid / Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-md">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono">
                    <th className="p-3">Código</th>
                    <th className="p-3">Nombre</th>
                    <th className="p-3">Categoría</th>
                    <th className="p-3">Costo</th>
                    <th className="p-3">Venta (IVA Inc.)</th>
                    <th className="p-3">Margen</th>
                    <th className="p-3 text-center">Stock</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 font-mono text-slate-300">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-6 text-center text-slate-500">No se encontraron productos en el catálogo.</td>
                    </tr>
                  ) : (
                    filteredProducts.map((p) => {
                      const category = categories.find((c) => c.id === p.categoryId);
                      const isLowStock = p.stock <= p.minStock;

                      return (
                        <tr key={p.id} className="hover:bg-slate-850/40">
                          <td className="p-3 text-slate-400">{p.code}</td>
                          <td className="p-3 font-semibold text-slate-200 font-sans text-xs">{p.name}</td>
                          <td className="p-3 text-slate-400 font-sans">{category?.name || 'General'}</td>
                          <td className="p-3">${p.costPrice.toLocaleString('es-AR')}</td>
                          <td className="p-3 font-bold text-emerald-400">${p.salePrice.toLocaleString('es-AR')}</td>
                          <td className="p-3 text-amber-400">{p.margin.toFixed(1)}%</td>
                          <td className="p-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isLowStock ? 'bg-rose-950 text-rose-400 border border-rose-900' : 'bg-slate-850 text-slate-300'
                            }`}>
                              {p.stock} / {p.minStock} min
                            </span>
                          </td>
                          <td className="p-3">
                            <button
                              onClick={() => handleToggleProductStatus(p)}
                              className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                                p.status === 'ACTIVE' ? 'bg-emerald-950 text-emerald-400' : 'bg-slate-800 text-slate-500'
                              }`}
                            >
                              {p.status}
                            </button>
                          </td>
                          <td className="p-3 text-right space-x-1">
                            <button
                              onClick={() => setAdjustProduct(p)}
                              className="text-amber-400 hover:text-amber-300 bg-slate-800 px-2 py-1 rounded text-[10px]"
                            >
                              Stock
                            </button>
                            <button
                              onClick={() => handleEditProductClick(p)}
                              className="text-emerald-400 hover:text-emerald-300 bg-slate-800 p-1 rounded inline-flex"
                              title="Editar"
                            >
                              <Edit2 size={12} />
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
      )}

      {/* --- TAB: CATEGORIES --- */}
      {activeTab === 'categories' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Create Category Panel */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl h-fit">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 font-sans">Nueva Categoría</h3>
            <form onSubmit={handleAddCategory} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1.5">Nombre de la Categoría</label>
                <input
                  type="text"
                  required
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 text-slate-200 px-3 py-2 rounded text-xs focus:outline-none focus:border-emerald-500"
                  placeholder="Ej. Bebidas, Almacén, Limpieza..."
                />
              </div>
              <button
                type="submit"
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold py-2 rounded text-xs tracking-wider uppercase transition-colors"
              >
                CREAR CATEGORÍA
              </button>
            </form>
          </div>

          {/* Categories List */}
          <div className="md:col-span-2 bg-slate-900 border border-slate-800 p-6 rounded-xl">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 font-sans">Categorías Existentes</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-mono">
                    <th className="py-2">ID</th>
                    <th className="py-2">Nombre</th>
                    <th className="py-2">Fecha de Creación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 font-mono text-slate-300">
                  {categories.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-slate-500">No hay categorías registradas.</td>
                    </tr>
                  ) : (
                    categories.map((c) => (
                      <tr key={c.id}>
                        <td className="py-2.5 text-slate-500">{c.id}</td>
                        <td className="py-2.5 font-bold text-slate-200 font-sans">{c.name}</td>
                        <td className="py-2.5 text-slate-400">{new Date(c.createdAt).toLocaleDateString('es-AR')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --- TAB: KARDEX (STOCK MOVEMENTS) --- */}
      {activeTab === 'kardex' && (
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-md">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 font-sans">Kardex - Registro Histórico de Movimientos de Stock</h3>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-mono">
                  <th className="py-2">Fecha / Hora</th>
                  <th className="py-2">Producto</th>
                  <th className="py-2">Tipo</th>
                  <th className="py-2 text-center">Previo</th>
                  <th className="py-2 text-center">Variación</th>
                  <th className="py-2 text-center">Actual</th>
                  <th className="py-2">Razón / Comprobante</th>
                  <th className="py-2">Operador</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-850 font-mono text-slate-300">
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-4 text-center text-slate-500">No hay movimientos registrados en el Kardex.</td>
                  </tr>
                ) : (
                  movements.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-850/20">
                      <td className="py-2">{new Date(m.createdAt).toLocaleString('es-AR')}</td>
                      <td className="py-2 text-slate-200 font-sans">{m.productName || 'Producto'}</td>
                      <td className="py-2">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          m.type === 'COMPRA' || m.type === 'ENTRADA' ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
                        }`}>
                          {m.type}
                        </span>
                      </td>
                      <td className="py-2 text-center text-slate-500">{m.qtyPrevious}</td>
                      <td className={`py-2 text-center font-bold ${m.qtyChange > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {m.qtyChange > 0 ? '+' : ''}{m.qtyChange}
                      </td>
                      <td className="py-2 text-center font-bold text-slate-100">{m.qtyAfter}</td>
                      <td className="py-2 text-slate-400 font-sans">{m.reason}</td>
                      <td className="py-2 text-slate-400 font-sans">{m.userName || 'Usuario'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- MODAL: CREATE / EDIT PRODUCT --- */}
      {isProductModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-800 flex justify-between items-center bg-slate-950">
              <h3 className="text-base font-bold text-slate-200 font-sans">
                {editingProduct ? `Editar Producto: ${editingProduct.name}` : 'Crear Nuevo Producto en Catálogo'}
              </h3>
              <button
                onClick={() => setIsProductModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Internal Code */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Código Interno (SKU) *</label>
                  <input
                    type="text"
                    required
                    value={prodCode}
                    onChange={(e) => setProdCode(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs focus:outline-none focus:border-emerald-500"
                    placeholder="Ej. COD01"
                  />
                </div>

                {/* Barcode */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Código de Barras (Lector Laser)</label>
                  <input
                    type="text"
                    value={prodBarcode}
                    onChange={(e) => setProdBarcode(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs focus:outline-none focus:border-emerald-500 font-mono"
                    placeholder="Escanee con la pistola laser..."
                  />
                </div>

                {/* Name */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-mono text-slate-400 mb-1">Nombre Completo del Producto *</label>
                  <input
                    type="text"
                    required
                    value={prodName}
                    onChange={(e) => setProdName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs focus:outline-none focus:border-emerald-500 font-sans"
                    placeholder="Ej. Coca Cola 1.5L Sabor Original"
                  />
                </div>

                {/* Description */}
                <div className="md:col-span-2">
                  <label className="block text-xs font-mono text-slate-400 mb-1">Descripción</label>
                  <textarea
                    value={prodDesc}
                    onChange={(e) => setProdDesc(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs focus:outline-none focus:border-emerald-500 font-sans"
                    placeholder="Detalles opcionales..."
                    rows={2}
                  />
                </div>

                {/* Category Selector */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Categoría *</label>
                  <select
                    value={prodCatId}
                    onChange={(e) => setProdCatId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs focus:outline-none focus:border-emerald-500"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {/* IVA Rate Selector */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Tasa de IVA % *</label>
                  <select
                    value={prodTax}
                    onChange={(e) => setProdTax(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs focus:outline-none focus:border-emerald-500 font-mono"
                  >
                    <option value="21">21.0% (Tasa general)</option>
                    <option value="10.5">10.5% (Tasa reducida)</option>
                    <option value="0">0.0% (Exento)</option>
                  </select>
                </div>

                {/* Cost Price */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Precio de Costo ($) *</label>
                  <input
                    type="number"
                    required
                    value={prodCost}
                    onChange={(e) => setProdCost(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs focus:outline-none focus:border-emerald-500 font-mono"
                    placeholder="0.00"
                    step="0.01"
                  />
                </div>

                {/* Sale Price */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Precio de Venta al Público ($) *</label>
                  <input
                    type="number"
                    required
                    value={prodPrice}
                    onChange={(e) => setProdPrice(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs focus:outline-none focus:border-emerald-500 font-mono"
                    placeholder="0.00"
                    step="0.01"
                  />
                </div>

                {/* Stock values */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Stock Actual (Fisico) *</label>
                  <input
                    type="number"
                    required
                    disabled={!!editingProduct} // manual adjust inside products table is preferred if editing
                    value={prodStock}
                    onChange={(e) => setProdStock(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs focus:outline-none focus:border-emerald-500 font-mono disabled:opacity-55"
                    placeholder="Cantidad"
                  />
                </div>

                {/* Min Stock */}
                <div>
                  <label className="block text-xs font-mono text-slate-400 mb-1">Alerta Stock Mínimo *</label>
                  <input
                    type="number"
                    required
                    value={prodMinStock}
                    onChange={(e) => setProdMinStock(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-slate-100 px-3 py-1.5 rounded text-xs focus:outline-none focus:border-emerald-500 font-mono"
                    placeholder="Mínimo"
                  />
                </div>

              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-4 py-2 rounded text-xs transition-colors"
                >
                  CANCELAR
                </button>
                <button
                  type="submit"
                  className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-4 py-2 rounded text-xs tracking-wider uppercase transition-colors"
                >
                  GUARDAR PRODUCTO
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
