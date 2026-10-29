export type Lang = 'es' | 'pt' | 'en';

export const LANGS: Lang[] = ['es', 'pt', 'en'];

export const LANG_NAMES: Record<Lang, string> = { es: 'Español', pt: 'Português', en: 'English' };

const LOCALES: Record<Lang, string> = { es: 'es-AR', pt: 'pt-BR', en: 'en-US' };

export const strings = {
  es: {
    pickup: 'Retiro en el local',
    delivery: 'Entrega a domicilio',
    all: 'Todo',
    add: 'Agregar',
    remove: 'Quitar uno',
    viewOrder: 'Ver pedido',
    yourOrder: 'Tu pedido',
    close: 'Cerrar',
    promos: 'Promociones',
    firstOrderHint: 'Escribe tu teléfono para aplicar tu descuento de primera compra.',
    firstOrderApplied: 'Descuento de primera compra aplicado',
    validUntil: (date: string) => `Hasta el ${date}`,
    minTotal: (amount: string) => `Pedido mínimo ${amount}`,
    firstOrderOnly: 'Solo en tu primer pedido',
    subtotal: 'Subtotal',
    discount: 'Descuento',
    total: 'Total',
    name: 'Tu nombre',
    phone: 'Tu WhatsApp',
    phoneHint: 'Con código de área, ej. 48 98810-2993',
    howToReceive: '¿Cómo lo recibes?',
    address: 'Dirección de entrega',
    notes: 'Aclaraciones (opcional)',
    notesHint: 'Ej.: sin cebolla, timbre, punto de referencia',
    paymentNote: 'El pago se coordina con el local al confirmar tu pedido.',
    send: 'Enviar pedido',
    sending: 'Enviando…',
    emptyCart: 'Todavía no agregaste nada. Elige algo rico del menú.',
    loading: 'Cargando el menú…',
    loadError: 'No pudimos cargar el menú.',
    retry: 'Reintentar',
    closedTitle: 'Estamos cerrados por ahora',
    closedText: 'Volvemos pronto. Puedes mirar el menú, pero todavía no recibimos pedidos.',
    noProducts: 'El menú se está actualizando. Vuelve en unos minutos.',
    thanksTitle: '¡Pedido recibido!',
    thanksCode: 'Tu código',
    thanksWhatsapp: 'Toca el botón para enviárselo al local por WhatsApp y confirmarlo.',
    thanksNoWhatsapp: 'El local ya lo tiene y te va a contactar para confirmarlo.',
    sendWhatsapp: 'Enviar por WhatsApp',
    newOrder: 'Hacer otro pedido',
    errName: 'Escribe tu nombre.',
    errPhone: 'Escribe tu teléfono con código de área.',
    errAddress: 'Escribe la dirección de entrega.',
    errGeneric: 'No pudimos enviar el pedido. Inténtalo de nuevo.',
    items: (count: number) => (count === 1 ? '1 producto' : `${count} productos`),
    language: 'Idioma',
    poweredBy: 'Pedidos directos, sin comisión',
  },
  pt: {
    pickup: 'Retirar no local',
    delivery: 'Entrega em casa',
    all: 'Tudo',
    add: 'Adicionar',
    remove: 'Tirar um',
    viewOrder: 'Ver pedido',
    yourOrder: 'Seu pedido',
    close: 'Fechar',
    promos: 'Promoções',
    firstOrderHint: 'Digite seu telefone para aplicar o desconto de primeira compra.',
    firstOrderApplied: 'Desconto de primeira compra aplicado',
    validUntil: (date: string) => `Até ${date}`,
    minTotal: (amount: string) => `Pedido mínimo ${amount}`,
    firstOrderOnly: 'Somente no seu primeiro pedido',
    subtotal: 'Subtotal',
    discount: 'Desconto',
    total: 'Total',
    name: 'Seu nome',
    phone: 'Seu WhatsApp',
    phoneHint: 'Com DDD, ex.: 48 98810-2993',
    howToReceive: 'Como quer receber?',
    address: 'Endereço de entrega',
    notes: 'Observações (opcional)',
    notesHint: 'Ex.: sem cebola, campainha, ponto de referência',
    paymentNote: 'O pagamento é combinado com o restaurante ao confirmar o pedido.',
    send: 'Enviar pedido',
    sending: 'Enviando…',
    emptyCart: 'Você ainda não adicionou nada. Escolha algo gostoso do cardápio.',
    loading: 'Carregando o cardápio…',
    loadError: 'Não conseguimos carregar o cardápio.',
    retry: 'Tentar de novo',
    closedTitle: 'Estamos fechados por enquanto',
    closedText: 'Voltamos logo. Você pode ver o cardápio, mas ainda não estamos recebendo pedidos.',
    noProducts: 'O cardápio está sendo atualizado. Volte em alguns minutos.',
    thanksTitle: 'Pedido recebido!',
    thanksCode: 'Seu código',
    thanksWhatsapp: 'Toque no botão para enviar ao restaurante pelo WhatsApp e confirmar.',
    thanksNoWhatsapp: 'O restaurante já recebeu e vai entrar em contato para confirmar.',
    sendWhatsapp: 'Enviar pelo WhatsApp',
    newOrder: 'Fazer outro pedido',
    errName: 'Digite seu nome.',
    errPhone: 'Digite seu telefone com DDD.',
    errAddress: 'Digite o endereço de entrega.',
    errGeneric: 'Não conseguimos enviar o pedido. Tente de novo.',
    items: (count: number) => (count === 1 ? '1 item' : `${count} itens`),
    language: 'Idioma',
    poweredBy: 'Pedidos diretos, sem comissão',
  },
  en: {
    pickup: 'Pick up at the shop',
    delivery: 'Home delivery',
    all: 'All',
    add: 'Add',
    remove: 'Remove one',
    viewOrder: 'View order',
    yourOrder: 'Your order',
    close: 'Close',
    promos: 'Promotions',
    firstOrderHint: 'Enter your phone number to get your first-order discount.',
    firstOrderApplied: 'First-order discount applied',
    validUntil: (date: string) => `Until ${date}`,
    minTotal: (amount: string) => `Minimum order ${amount}`,
    firstOrderOnly: 'First order only',
    subtotal: 'Subtotal',
    discount: 'Discount',
    total: 'Total',
    name: 'Your name',
    phone: 'Your WhatsApp',
    phoneHint: 'With area code, e.g. +55 48 98810-2993',
    howToReceive: 'How do you want it?',
    address: 'Delivery address',
    notes: 'Notes (optional)',
    notesHint: 'E.g. no onions, doorbell, landmark',
    paymentNote: 'Payment is arranged with the shop when they confirm your order.',
    send: 'Place order',
    sending: 'Sending…',
    emptyCart: 'You have not added anything yet. Pick something tasty from the menu.',
    loading: 'Loading the menu…',
    loadError: 'We could not load the menu.',
    retry: 'Try again',
    closedTitle: 'We are closed right now',
    closedText: 'We will be back soon. You can browse the menu, but we are not taking orders yet.',
    noProducts: 'The menu is being updated. Please come back in a few minutes.',
    thanksTitle: 'Order received!',
    thanksCode: 'Your code',
    thanksWhatsapp: 'Tap the button to send it to the shop on WhatsApp and confirm it.',
    thanksNoWhatsapp: 'The shop has it and will contact you to confirm.',
    sendWhatsapp: 'Send on WhatsApp',
    newOrder: 'Place another order',
    errName: 'Please enter your name.',
    errPhone: 'Please enter your phone number with area code.',
    errAddress: 'Please enter the delivery address.',
    errGeneric: 'We could not send your order. Please try again.',
    items: (count: number) => (count === 1 ? '1 item' : `${count} items`),
    language: 'Language',
    poweredBy: 'Direct orders, no commission',
  },
} as const;

/** Nombres de categoría conocidos; las que el negocio inventa se muestran tal cual. */
const CATEGORIES: Record<string, Record<Lang, string>> = {
  Pizzas: { es: 'Pizzas', pt: 'Pizzas', en: 'Pizzas' },
  Hamburguesas: { es: 'Hamburguesas', pt: 'Hambúrgueres', en: 'Burgers' },
  'Sándwiches': { es: 'Sándwiches', pt: 'Sanduíches', en: 'Sandwiches' },
  'Tequeños': { es: 'Tequeños', pt: 'Tequeños', en: 'Tequeños' },
  Bebidas: { es: 'Bebidas', pt: 'Bebidas', en: 'Drinks' },
  Postres: { es: 'Postres', pt: 'Sobremesas', en: 'Desserts' },
  Combos: { es: 'Combos', pt: 'Combos', en: 'Combos' },
  Extras: { es: 'Extras', pt: 'Extras', en: 'Extras' },
  'Para picar': { es: 'Para picar', pt: 'Petiscos', en: 'Snacks' },
  Empanadas: { es: 'Empanadas', pt: 'Empanadas', en: 'Empanadas' },
  Arepas: { es: 'Arepas', pt: 'Arepas', en: 'Arepas' },
};

export function categoryLabel(category: string, lang: Lang): string {
  return CATEGORIES[category]?.[lang] ?? category;
}

const formatters = new Map<Lang, Intl.NumberFormat>();

export function formatMoney(value: number, lang: Lang): string {
  let formatter = formatters.get(lang);
  if (!formatter) {
    // Los precios son siempre en reales (R$); solo cambia la forma de escribir el número.
    formatter = new Intl.NumberFormat(LOCALES[lang], { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    formatters.set(lang, formatter);
  }
  return `R$\u00a0${formatter.format(value)}`;
}

export function formatDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { day: '2-digit', month: 'short' }).format(new Date(`${iso}T12:00:00`));
}

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem('portal-lang');
    if (saved === 'es' || saved === 'pt' || saved === 'en') return saved;
  } catch {
    /* sin almacenamiento: se usa el idioma del navegador */
  }
  const browser = (navigator.language || 'es').slice(0, 2).toLowerCase();
  return browser === 'pt' || browser === 'en' ? browser : 'es';
}
