import { Asset, MaintenanceLog } from '../types';

/**
 * Sanitiza o nome do colaborador/técnico para conformidade estrita com a LGPD (Lei 13.709/2018).
 * Pseudonimiza nomes completos para exibição pública em QR Code (ex: "Daniel Fabre da Silva" -> "Téc. Daniel F.")
 */
export function sanitizeTechnicianName(rawName?: string | null): string {
  if (!rawName || !rawName.trim()) {
    return 'Equipe Técnica Autorizada';
  }

  const clean = rawName.trim();

  // Se já for genérico
  if (/^(equipe|técnico|tecnico|suporte|manutenção|manutencao)/i.test(clean)) {
    return clean;
  }

  // Remove eventuais prefixos existentes como "Téc. ", "Técnico "
  const withoutPrefix = clean.replace(/^(t[ée]c(?:nico)?\.?\s*)/i, '').trim();

  // Se tiver matrícula entre parênteses ou traço, ex: "Daniel Fabre - 10423" ou "Daniel Fabre (10423)"
  let matriculaMasked = '';
  const matriculaMatch = withoutPrefix.match(/(?:[-–(]\s*(?:matr[íi]cula|id|mat\.?)?\s*[:.]?\s*)(\d{3,})(\)?)/i);
  let baseName = withoutPrefix;
  if (matriculaMatch) {
    const rawMat = matriculaMatch[1];
    matriculaMasked = ` (ID: ***${rawMat.slice(-2)})`;
    baseName = withoutPrefix.replace(matriculaMatch[0], '').trim();
  }

  const parts = baseName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return 'Técnico Especializado' + matriculaMasked;
  }

  if (parts.length === 1) {
    return `Téc. ${parts[0]}${matriculaMasked}`;
  }

  // Primeiro nome + Inicial do último sobrenome
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase() + '.';
  return `Téc. ${firstName} ${lastInitial}${matriculaMasked}`;
}

/**
 * Sanitiza notas e laudos de manutenção contra vazamento acidental de dados pessoais,
 * contatos de terceiros, documentos (CPF/RG) ou valores comerciais internos.
 */
export function sanitizePublicNotes(notes?: string | null): string {
  if (!notes || !notes.trim()) return '';

  let sanitized = notes;

  // 1. Mascarar telefones e celulares brasileiros (ex: (21) 98888-7777, 21988887777, 98888-7777)
  sanitized = sanitized.replace(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/g, '[Contato Protegido]');

  // 2. Mascarar e-mails
  sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[E-mail Protegido]');

  // 3. Mascarar CPFs (formatados ou não)
  sanitized = sanitized.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[Documento Protegido]');

  // 4. Mascarar informações comerciais ou orçamentárias explícitas (ex: R$ 1.500,00 ou Custo: 300)
  sanitized = sanitized.replace(/(?:R\$\s*|or[çc]amento:\s*|custo:\s*|pre[çc]o:\s*|valor:\s*)\d+(?:[.,]\d{2})?/gi, '[Dado Comercial Omitido]');

  return sanitized.trim();
}

/**
 * Higieniza o objeto Asset para exibição pública:
 * - Remove campos proprietários internos desnecessários
 * - Garante ausência de strings base64 pesadas
 */
export function sanitizePublicAsset(rawAsset: Asset): Asset {
  const cleanSpecs: Asset['specs'] = {
    model: rawAsset.specs?.model || '',
    serialNumber: rawAsset.specs?.serialNumber || '',
    installationDate: rawAsset.specs?.installationDate || '',
    manufacturer: rawAsset.specs?.manufacturer || '',
    power: rawAsset.specs?.power,
    capacity: rawAsset.specs?.capacity,
    voltage: rawAsset.specs?.voltage,
    warrantyUntil: rawAsset.specs?.warrantyUntil,
    ...(rawAsset.specs || {})
  };

  // Remove chaves de specs que possam conter dados sensíveis de compra ou fornecedor
  const sensitiveSpecKeys = ['fornecedor', 'custo', 'nf', 'nota_fiscal', 'comprador', 'valor_compra', 'contrato_compra'];
  for (const key of Object.keys(cleanSpecs)) {
    if (sensitiveSpecKeys.some(s => key.toLowerCase().includes(s))) {
      delete cleanSpecs[key];
    }
  }

  return {
    ...rawAsset,
    specs: cleanSpecs,
    qrCode: undefined // sempre limpo
  };
}

/**
 * Higieniza o registro de histórico para consumo público (LGPD compliant).
 */
export function sanitizePublicLog(rawLog: MaintenanceLog): MaintenanceLog {
  return {
    ...rawLog,
    technician: sanitizeTechnicianName(rawLog.technician),
    notes: sanitizePublicNotes(rawLog.notes)
  };
}
