import React, { useState, useMemo, useEffect } from 'react';
import { Product, ProductCategory, Currency } from '../types';
import { 
  ShoppingBag, 
  ShoppingCart, 
  Plus, 
  Minus, 
  Trash2, 
  Search, 
  Share2, 
  Check, 
  Copy, 
  MessageCircle, 
  Send, 
  ExternalLink, 
  Store, 
  X, 
  Filter, 
  Tag, 
  AlertCircle, 
  MapPin, 
  User, 
  Phone, 
  Sparkles,
  RefreshCw,
  Info
} from 'lucide-react';
import { safeGetItem, safeSetItem } from '../services/storageService';

interface Props {
  inventory: Product[];
  rate: number;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onExitCatalog?: () => void;
  isStandalonePublicView?: boolean;
}

export interface CatalogCartItem {
  product: Product;
  quantity: number;
}

export const PublicCatalog: React.FC<Props> = ({
  inventory,
  rate,
  onRefresh,
  isRefreshing = false,
  onExitCatalog,
  isStandalonePublicView = false
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | 'ALL'>('ALL');
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [cart, setCart] = useState<CatalogCartItem[]>(() => {
    try {
      const saved = safeGetItem('venstore_catalog_cart');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [customerName, setCustomerName] = useState(() => safeGetItem('venstore_customer_name') || '');
  const [deliveryMethod, setDeliveryMethod] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [orderNotes, setOrderNotes] = useState('');

  // Número de WhatsApp oficial (por defecto el solicitado por el usuario: +584145383890)
  const [whatsappNumber, setWhatsappNumber] = useState(() => {
    return safeGetItem('venstore_whatsapp_phone') || '584145383890';
  });
  const [isEditingPhone, setIsEditingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState(whatsappNumber);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedOrderText, setCopiedOrderText] = useState(false);

  // Persistir carrito en LocalStorage
  useEffect(() => {
    safeSetItem('venstore_catalog_cart', JSON.stringify(cart));
  }, [cart]);

  // Persistir nombre de cliente
  useEffect(() => {
    if (customerName) {
      safeSetItem('venstore_customer_name', customerName);
    }
  }, [customerName]);

  // Filtrado de productos disponibles
  const filteredProducts = useMemo(() => {
    return inventory.filter(product => {
      if (!product) return false;
      const matchesSearch = !searchTerm || 
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (product.category && product.category.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (product.barcode && product.barcode.includes(searchTerm));

      const matchesCat = selectedCategory === 'ALL' || product.category === selectedCategory;
      const matchesStock = !onlyInStock || (typeof product.stock === 'number' && product.stock > 0);

      return matchesSearch && matchesCat && matchesStock;
    });
  }, [inventory, searchTerm, selectedCategory, onlyInStock]);

  // Conteo de items en carrito
  const totalCartItems = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }, [cart]);

  // Cálculo de totales
  const totals = useMemo(() => {
    let totalUSD = 0;
    cart.forEach(item => {
      const priceUSD = item.product.currency === Currency.USD 
        ? item.product.price 
        : (rate > 0 ? item.product.price / rate : 0);
      totalUSD += priceUSD * item.quantity;
    });
    const totalBsF = totalUSD * rate;
    return { totalUSD, totalBsF };
  }, [cart, rate]);

  // Agregar al carrito
  const handleAddToCart = (product: Product) => {
    const currentStock = typeof product.stock === 'number' ? product.stock : 0;
    if (currentStock <= 0) {
      alert(`El producto "${product.name}" está actualmente agotado.`);
      return;
    }

    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= currentStock) {
          alert(`Has alcanzado la cantidad máxima disponible (${currentStock} ${product.unit || 'unidades'}) para este producto.`);
          return prev;
        }
        return prev.map(item => 
          item.product.id === product.id 
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        return [...prev, { product, quantity: 1 }];
      }
    });
  };

  // Quitar o restar cantidad
  const handleDecreaseQuantity = (productId: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === productId);
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        return prev.filter(item => item.product.id !== productId);
      }
      return prev.map(item => 
        item.product.id === productId 
          ? { ...item, quantity: item.quantity - 1 }
          : item
      );
    });
  };

  // Eliminar completamente
  const handleRemoveFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  // Vaciar carrito
  const handleClearCart = () => {
    if (window.confirm('¿Deseas vaciar todos los productos del carrito?')) {
      setCart([]);
    }
  };

  // Guardar nuevo número de WhatsApp
  const handleSavePhone = () => {
    const cleaned = phoneInput.replace(/[^0-9]/g, '');
    if (!cleaned) {
      alert('Por favor ingresa un número de teléfono válido con código de país (ej. 584145383890)');
      return;
    }
    setWhatsappNumber(cleaned);
    safeSetItem('venstore_whatsapp_phone', cleaned);
    setIsEditingPhone(false);
  };

  // Generar mensaje formateado de WhatsApp
  const generateWhatsAppMessage = () => {
    const cleanClientName = customerName.trim() || 'Cliente de la Tienda';
    const cleanRate = rate > 0 ? rate.toFixed(2) : '36.50';
    
    let msg = `🛒 *NUEVO PEDIDO - CATÁLOGO VIRTUAL*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `👤 *Cliente:* ${cleanClientName}\n`;
    msg += `📍 *Modalidad:* ${deliveryMethod === 'PICKUP' ? 'Retiro en Tienda' : 'Entrega a Domicilio'}\n`;
    if (deliveryMethod === 'DELIVERY' && deliveryAddress.trim()) {
      msg += `🏠 *Dirección:* ${deliveryAddress.trim()}\n`;
    }
    if (orderNotes.trim()) {
      msg += `📝 *Nota:* ${orderNotes.trim()}\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `📦 *DETALLE DEL PEDIDO:*\n`;
    cart.forEach((item, index) => {
      const p = item.product;
      const unitPriceUSD = p.currency === Currency.USD ? p.price : (rate > 0 ? p.price / rate : 0);
      const unitPriceBsF = unitPriceUSD * rate;
      const subtotalUSD = unitPriceUSD * item.quantity;
      const subtotalBsF = subtotalUSD * rate;

      msg += `${index + 1}. *${item.quantity}x* ${p.name} (${p.unit || 'Und'})\n`;
      msg += `   └ Precio: $${unitPriceUSD.toFixed(2)} / ${unitPriceBsF.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs.\n`;
      msg += `   └ Subtotal: *$${subtotalUSD.toFixed(2)}* / *${subtotalBsF.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs.*\n\n`;
    });

    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💰 *RESUMEN TOTAL:*\n`;
    msg += `💵 *Total en Divisas:* $${totals.totalUSD.toFixed(2)} USD\n`;
    msg += `🇻🇪 *Total en Bolívares:* ${totals.totalBsF.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs.\n`;
    msg += `📊 *Tasa del día:* ${cleanRate} Bs/$\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `📲 *SOLICITUD DE PAGO MÓVIL:*\n`;
    msg += `Por favor, envíeme los datos para realizar el *Pago Móvil* (Banco, Cédula/RIF, Teléfono) para transferir el total y concretar mi compra.\n\n`;
    msg += `¡Muchas gracias! Quedo atento a su respuesta.`;

    return msg;
  };

  // Enviar pedido por WhatsApp
  const handleSendWhatsAppOrder = () => {
    if (cart.length === 0) {
      alert('Tu carrito está vacío. Agrega al menos un producto para generar el pedido.');
      return;
    }

    const message = generateWhatsAppMessage();
    const encodedMessage = encodeURIComponent(message);
    const targetPhone = whatsappNumber.replace(/[^0-9]/g, '') || '584145383890';
    const whatsappUrl = `https://wa.me/${targetPhone}?text=${encodedMessage}`;

    // Abrir WhatsApp en una nueva pestaña
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  // Copiar enlace público del catálogo
  const handleCopyCatalogLink = () => {
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    const catalogUrl = `${origin}${pathname}?tab=CATALOG`;
    navigator.clipboard.writeText(catalogUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }).catch(() => {
      prompt('Copia este enlace para compartir el catálogo:', catalogUrl);
    });
  };

  // Copiar texto del pedido
  const handleCopyOrderText = () => {
    if (cart.length === 0) return;
    const message = generateWhatsAppMessage();
    navigator.clipboard.writeText(message).then(() => {
      setCopiedOrderText(true);
      setTimeout(() => setCopiedOrderText(false), 2500);
    }).catch(() => {
      alert('No se pudo copiar el texto automáticamente.');
    });
  };

  return (
    <div className="bg-slate-50 min-h-[750px] pb-24 relative">
      {/* Header del Catálogo */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 py-3.5 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm shrink-0">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-black text-slate-800 tracking-tight">Catálogo Digital</h1>
                  <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-emerald-600" /> Pedido por WhatsApp
                  </span>
                </div>
                <p className="text-xs text-slate-500 flex items-center gap-2">
                  <span>Precios en USD y Bs. calculados a la tasa actual</span>
                  <span className="font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                    Tasa: {rate > 0 ? rate.toFixed(2) : '36.50'} Bs/$
                  </span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  className="p-2 text-slate-600 hover:text-emerald-700 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200 flex items-center gap-1 text-xs font-semibold"
                  title="Refrescar catálogo desde Neon"
                >
                  <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-600' : ''}`} />
                  <span className="hidden md:inline">{isRefreshing ? 'Actualizando...' : 'Refrescar'}</span>
                </button>
              )}

              <button
                onClick={handleCopyCatalogLink}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-xs transition-colors flex items-center gap-1.5 border border-slate-200 cursor-pointer"
                title="Copiar enlace público del catálogo para clientes"
              >
                {copiedLink ? <Check className="w-4 h-4 text-emerald-600" /> : <Share2 className="w-4 h-4 text-slate-600" />}
                <span>{copiedLink ? '¡Enlace Copiado!' : 'Compartir Catálogo'}</span>
              </button>

              <button
                onClick={() => setIsCartOpen(true)}
                className="relative px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs transition-colors flex items-center gap-2 shadow-sm cursor-pointer"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Ver Carrito</span>
                {totalCartItems > 0 && (
                  <span className="bg-amber-400 text-slate-900 text-[11px] font-black px-1.5 py-0.2 rounded-full">
                    {totalCartItems}
                  </span>
                )}
              </button>

              {onExitCatalog && !isStandalonePublicView && (
                <button
                  onClick={onExitCatalog}
                  className="px-3 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg text-xs font-semibold border border-slate-200"
                >
                  Volver al POS
                </button>
              )}
            </div>
          </div>

          {/* Configuración Rápida de Teléfono para el Administrador */}
          <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
              <span>Número de recepción de pedidos WhatsApp:</span>
              {isEditingPhone ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="584145383890"
                    className="px-2 py-0.5 border border-emerald-400 rounded text-slate-800 text-xs w-36 focus:outline-hidden"
                  />
                  <button
                    onClick={handleSavePhone}
                    className="px-2 py-0.5 bg-emerald-600 text-white rounded font-bold text-[11px] hover:bg-emerald-700"
                  >
                    Guardar
                  </button>
                  <button
                    onClick={() => {
                      setPhoneInput(whatsappNumber);
                      setIsEditingPhone(false);
                    }}
                    className="px-1.5 py-0.5 text-slate-500 hover:text-slate-700 text-[11px]"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                  <span>+{whatsappNumber}</span>
                  <button
                    onClick={() => setIsEditingPhone(true)}
                    className="text-[10px] text-emerald-700 underline ml-1 hover:text-emerald-900"
                  >
                    Cambiar
                  </button>
                </div>
              )}
            </div>

            <div className="text-[11px] text-slate-400">
              Mostrando <strong className="text-slate-700">{filteredProducts.length}</strong> de {inventory.length} productos
            </div>
          </div>
        </div>
      </header>

      {/* Controles de Búsqueda y Filtros */}
      <div className="max-w-7xl mx-auto px-4 pt-4 pb-2">
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-xs space-y-3">
          <div className="flex flex-col md:flex-row gap-2.5">
            {/* Buscador */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar por nombre, código o categoría..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Checkbox solo con stock */}
            <label className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-100 text-xs font-semibold text-slate-700 select-none shrink-0">
              <input
                type="checkbox"
                checked={onlyInStock}
                onChange={(e) => setOnlyInStock(e.target.checked)}
                className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
              />
              <span>Solo productos disponibles</span>
            </label>
          </div>

          {/* Chips de Categorías */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 mr-1 shrink-0">
              <Filter className="w-3 h-3" /> Categoría:
            </span>
            <button
              onClick={() => setSelectedCategory('ALL')}
              className={`whitespace-nowrap px-3 py-1 rounded-full text-xs font-bold transition-all border ${
                selectedCategory === 'ALL'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                  : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
              }`}
            >
              Todas ({inventory.length})
            </button>
            {Object.values(ProductCategory).map(cat => {
              const count = inventory.filter(p => p.category === cat).length;
              if (count === 0) return null;
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`whitespace-nowrap px-3 py-1 rounded-full text-xs font-bold transition-all border ${
                    isSelected
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                  }`}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Grid de Productos */}
      <main className="max-w-7xl mx-auto px-4 py-4">
        {filteredProducts.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center max-w-lg mx-auto shadow-xs">
            <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
              <Search className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-800 mb-1">No se encontraron productos</h3>
            <p className="text-xs text-slate-500 mb-4">
              Intenta cambiar los términos de búsqueda o selecciona otra categoría.
            </p>
            {(searchTerm || selectedCategory !== 'ALL' || onlyInStock) && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setSelectedCategory('ALL');
                  setOnlyInStock(false);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors"
              >
                Restablecer Filtros
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredProducts.map(product => {
              const currentStock = typeof product.stock === 'number' ? product.stock : 0;
              const isAvailable = currentStock > 0;
              const cartItem = cart.find(item => item.product.id === product.id);
              const qtyInCart = cartItem ? cartItem.quantity : 0;

              const priceUSD = product.currency === Currency.USD 
                ? product.price 
                : (rate > 0 ? product.price / rate : 0);
              const priceBsF = priceUSD * rate;

              return (
                <div
                  key={product.id}
                  className={`bg-white rounded-xl border transition-all duration-150 flex flex-col justify-between overflow-hidden shadow-xs hover:shadow-md ${
                    isAvailable ? 'border-slate-200 hover:border-emerald-300' : 'border-slate-200 opacity-70 bg-slate-50/70'
                  }`}
                >
                  <div className="p-4 space-y-3">
                    {/* Header de la Tarjeta: Categoría y Disponibilidad */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 truncate max-w-[140px]">
                        <Tag className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{product.category || 'Varios'}</span>
                      </span>

                      {isAvailable ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Disponible ({currentStock} {product.unit || 'Und'})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200 shrink-0">
                          Agotado
                        </span>
                      )}
                    </div>

                    {/* Nombre del Producto */}
                    <div>
                      <h3 className="font-bold text-slate-800 text-base line-clamp-2 leading-snug" title={product.name}>
                        {product.name}
                      </h3>
                      {product.barcode && (
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                          Cód: {product.barcode}
                        </p>
                      )}
                    </div>

                    {/* Precios: USD y Bs */}
                    <div className="pt-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-black text-slate-900 tracking-tight">
                          ${priceUSD.toFixed(2)}
                        </span>
                        <span className="text-xs font-semibold text-slate-400">USD</span>
                      </div>
                      <div className="text-sm font-bold text-emerald-700">
                        ≈ {priceBsF.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs.
                      </div>
                    </div>
                  </div>

                  {/* Acciones de Carrito */}
                  <div className="p-3 bg-slate-50 border-t border-slate-100">
                    {!isAvailable ? (
                      <button
                        disabled
                        className="w-full py-2 bg-slate-200 text-slate-400 font-bold text-xs rounded-lg cursor-not-allowed text-center"
                      >
                        Agotado temporalmente
                      </button>
                    ) : qtyInCart > 0 ? (
                      <div className="flex items-center justify-between bg-white border border-emerald-500 rounded-lg p-1 shadow-xs">
                        <button
                          onClick={() => handleDecreaseQuantity(product.id)}
                          className="w-8 h-8 rounded-md bg-slate-100 hover:bg-rose-100 text-slate-700 hover:text-rose-700 flex items-center justify-center transition-colors cursor-pointer"
                          title="Disminuir"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <div className="text-center px-2">
                          <span className="font-black text-sm text-emerald-800">{qtyInCart}</span>
                          <span className="text-[10px] text-slate-400 ml-1 font-semibold">{product.unit || 'Und'}</span>
                        </div>
                        <button
                          onClick={() => handleAddToCart(product)}
                          disabled={qtyInCart >= currentStock}
                          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                            qtyInCart >= currentStock
                              ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                          }`}
                          title="Aumentar"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleAddToCart(product)}
                        className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Agregar al Carrito</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Botón Flotante de Carrito en Móvil y Escritorio */}
      {totalCartItems > 0 && (
        <aside aria-label="Carrito de compras" className="fixed bottom-5 right-5 z-40 animate-fade-in-up">
          <button
            onClick={() => setIsCartOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white p-3.5 sm:px-5 sm:py-3.5 rounded-full shadow-lg hover:shadow-xl transition-all flex items-center gap-3 cursor-pointer group border-2 border-white"
          >
            <div className="relative">
              <ShoppingCart className="w-6 h-6" />
              <span className="absolute -top-2 -right-2 bg-amber-400 text-slate-900 font-black text-xs w-5 h-5 rounded-full flex items-center justify-center border-2 border-emerald-600">
                {totalCartItems}
              </span>
            </div>
            <div className="hidden sm:flex flex-col text-left">
              <span className="text-[11px] font-bold text-emerald-100 uppercase tracking-wider">Ver Mi Pedido</span>
              <span className="text-sm font-black tracking-tight leading-tight">
                ${totals.totalUSD.toFixed(2)} / {totals.totalBsF.toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} Bs.
              </span>
            </div>
          </button>
        </aside>
      )}

      {/* Drawer / Modal del Carrito de Compras */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onClick={() => setIsCartOpen(false)}
          />

          {/* Drawer Panel */}
          <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col z-10 animate-slide-in-right">
            {/* Header del Carrito */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                  <ShoppingCart className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-800 leading-tight">Carrito de Compras</h2>
                  <p className="text-xs text-slate-500">{totalCartItems} {totalCartItems === 1 ? 'producto seleccionado' : 'productos seleccionados'}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {cart.length > 0 && (
                  <button
                    onClick={handleClearCart}
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition-colors text-xs font-semibold"
                    title="Vaciar carrito"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setIsCartOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Contenido del Carrito */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {cart.length === 0 ? (
                <div className="py-16 text-center space-y-3">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-300">
                    <ShoppingBag className="w-8 h-8" />
                  </div>
                  <h3 className="font-bold text-slate-700 text-sm">Tu carrito está vacío</h3>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto">
                    Selecciona los productos del catálogo que deseas pedir y agrégalos con el botón (+).
                  </p>
                  <button
                    onClick={() => setIsCartOpen(false)}
                    className="mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors"
                  >
                    Ver Catálogo de Productos
                  </button>
                </div>
              ) : (
                <>
                  {/* Lista de Items */}
                  <div className="space-y-2.5">
                    {cart.map(item => {
                      const p = item.product;
                      const unitPriceUSD = p.currency === Currency.USD 
                        ? p.price 
                        : (rate > 0 ? p.price / rate : 0);
                      const subtotalUSD = unitPriceUSD * item.quantity;
                      const subtotalBsF = subtotalUSD * rate;
                      const currentStock = typeof p.stock === 'number' ? p.stock : 0;

                      return (
                        <div 
                          key={p.id}
                          className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-3"
                        >
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-slate-800 text-xs truncate leading-snug" title={p.name}>
                              {p.name}
                            </h4>
                            <p className="text-[11px] text-slate-500">
                              ${unitPriceUSD.toFixed(2)} c/u
                            </p>
                            <div className="text-xs font-black text-slate-900 mt-0.5">
                              ${subtotalUSD.toFixed(2)} <span className="text-[10px] font-bold text-emerald-700 font-mono">({subtotalBsF.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs)</span>
                            </div>
                          </div>

                          {/* Controles de Cantidad */}
                          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg p-1 shrink-0 shadow-2xs">
                            <button
                              onClick={() => handleDecreaseQuantity(p.id)}
                              className="w-6 h-6 rounded bg-slate-100 hover:bg-rose-100 hover:text-rose-700 flex items-center justify-center text-slate-600 transition-colors"
                              title="Restar"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-6 text-center font-black text-xs text-slate-800">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => handleAddToCart(p)}
                              disabled={item.quantity >= currentStock}
                              className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                                item.quantity >= currentStock
                                  ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                              }`}
                              title="Sumar"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>

                          {/* Botón Eliminar */}
                          <button
                            onClick={() => handleRemoveFromCart(p.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md transition-colors shrink-0"
                            title="Eliminar del carrito"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Datos del Cliente y Pedido */}
                  <div className="bg-slate-50 rounded-xl border border-slate-200 p-3.5 space-y-3">
                    <h4 className="font-bold text-xs text-slate-700 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-emerald-600" />
                      Datos del Pedido (Para WhatsApp)
                    </h4>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Tu Nombre o Nombre de Contacto:
                      </label>
                      <input
                        type="text"
                        placeholder="Ej. Juan Pérez"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Modalidad de Entrega:
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setDeliveryMethod('PICKUP')}
                          className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all border text-center ${
                            deliveryMethod === 'PICKUP'
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          Retiro en Tienda
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeliveryMethod('DELIVERY')}
                          className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all border text-center ${
                            deliveryMethod === 'DELIVERY'
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          Envío / Domicilio
                        </button>
                      </div>
                    </div>

                    {deliveryMethod === 'DELIVERY' && (
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Dirección o Punto de Referencia:
                        </label>
                        <input
                          type="text"
                          placeholder="Ej. Sector Centro, Casa #12 frente a la plaza"
                          value={deliveryAddress}
                          onChange={(e) => setDeliveryAddress(e.target.value)}
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Notas o Instrucciones (Opcional):
                      </label>
                      <input
                        type="text"
                        placeholder="Ej. Por favor empacar en bolsa separada..."
                        value={orderNotes}
                        onChange={(e) => setOrderNotes(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  {/* Resumen de Pago Móvil Informativo */}
                  <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-emerald-900">
                      <Phone className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Pago Móvil al concretar</span>
                    </div>
                    <p className="text-[11px] text-emerald-800 leading-snug">
                      Al enviar el pedido por WhatsApp, se solicitará automáticamente al negocio los datos de Pago Móvil para realizar la transferencia con el monto exacto en Bolívares.
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Footer del Carrito con Totales y Botón de WhatsApp */}
            {cart.length > 0 && (
              <div className="p-4 border-t border-slate-200 bg-white space-y-3">
                {/* Desglose de Totales */}
                <div className="space-y-1 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="flex justify-between items-baseline text-xs text-slate-500 font-medium">
                    <span>Tasa de Cambio del Día:</span>
                    <span className="font-semibold text-slate-700">{rate > 0 ? rate.toFixed(2) : '36.50'} Bs/$</span>
                  </div>
                  <div className="flex justify-between items-baseline text-sm font-bold text-slate-800 pt-1 border-t border-slate-200">
                    <span>Total en Divisas:</span>
                    <span className="text-base font-black text-slate-900">${totals.totalUSD.toFixed(2)} USD</span>
                  </div>
                  <div className="flex justify-between items-baseline text-sm font-bold text-emerald-700">
                    <span>Total en Bolívares:</span>
                    <span className="text-lg font-black text-emerald-800 font-mono">
                      {totals.totalBsF.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs.
                    </span>
                  </div>
                </div>

                {/* Botón Principal de Enviar Pedido por WhatsApp */}
                <button
                  onClick={handleSendWhatsAppOrder}
                  className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black text-sm rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                >
                  <MessageCircle className="w-5 h-5 fill-white/20" />
                  <span>Enviar Pedido por WhatsApp</span>
                </button>

                {/* Alternativa: Copiar texto del pedido */}
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
                  <span>¿Problemas abriendo WhatsApp?</span>
                  <button
                    onClick={handleCopyOrderText}
                    className="text-emerald-700 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    {copiedOrderText ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedOrderText ? '¡Copiado!' : 'Copiar texto del pedido'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
