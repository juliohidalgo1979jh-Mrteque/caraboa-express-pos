/** Cobro por Pix: arma el código "copia y pega" (BR Code estático del Banco Central) con el monto del pedido. */

export type PixKeyType = 'NONE' | 'CPF_CNPJ' | 'CELULAR' | 'EMAIL' | 'ALEATORIA';

export interface PixConfig {
  keyType: PixKeyType;
  key: string;
  name: string;
  city: string;
  link: string;
}

export const defaultPix: PixConfig = { keyType: 'NONE', key: '', name: '', city: '', link: '' };

export const keyTypeLabels: Record<PixKeyType, string> = {
  NONE: 'Sin clave Pix (solo enlace de pago)',
  CPF_CNPJ: 'CPF o CNPJ',
  CELULAR: 'Celular',
  EMAIL: 'Correo electrónico',
  ALEATORIA: 'Clave aleatoria',
};

export function hasPixKey(config: PixConfig): boolean {
  return config.keyType !== 'NONE' && !!config.key.trim() && !!config.name.trim() && !!config.city.trim();
}

/** Deja la clave en el formato que exige el Pix: celular con +55, CPF/CNPJ solo dígitos. */
export function normalizePixKey(type: PixKeyType, raw: string): string {
  const value = raw.trim();
  const digits = value.replace(/\D/g, '');
  if (type === 'CPF_CNPJ') return digits;
  if (type === 'CELULAR') return digits.length <= 11 ? `+55${digits}` : `+${digits}`;
  if (type === 'EMAIL') return value.toLowerCase();
  return value;
}

function field(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** Quita acentos y símbolos: el BR Code solo admite ASCII simple. */
function ascii(text: string, max: number): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, max);
}

export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildPixPayload(config: PixConfig, amount: number, txid: string): string {
  const account = field('00', 'br.gov.bcb.pix') + field('01', normalizePixKey(config.keyType, config.key));
  const reference = ascii(txid, 25).replace(/ /g, '') || '***';
  const body = [
    field('00', '01'),
    field('01', '11'),
    field('26', account),
    field('52', '0000'),
    field('53', '986'),
    ...(amount > 0 ? [field('54', amount.toFixed(2))] : []),
    field('58', 'BR'),
    field('59', ascii(config.name, 25) || 'NA'),
    field('60', ascii(config.city, 15) || 'BRASIL'),
    field('62', field('05', reference)),
  ].join('');
  const withCrcId = `${body}6304`;
  return `${withCrcId}${crc16(withCrcId)}`;
}

/** Mensaje para el cliente (en portugués, el idioma de la clientela). Incluye código copia y pega y/o enlace. */
export function pixMessage(config: PixConfig, amountText: string, orderCode: string | null, payload: string | null): string {
  return [
    '*Caraboa Express* 🍕',
    `${orderCode ? `Pedido *${orderCode}* · ` : ''}Total: *${amountText}*`,
    '',
    ...(payload ? ['Pague com *Pix copia e cola* (copie a mensagem abaixo e cole no app do seu banco):', '', payload, ''] : []),
    ...(config.link.trim() ? [`Ou pague pelo link: ${config.link.trim()}`, ''] : []),
    'Obrigado! Assim que o pagamento cair, preparamos seu pedido. 🙏',
  ].join('\n');
}
