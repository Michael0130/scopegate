/**
 * Evidence Dossier Builder Tool
 * 履约证据包构建工具：从会话决策记录和交付物理指纹组装符合 PayPal Seller Protection 采信标准的抗辩 Dossier
 */
import { buildDossier } from '../../../src/paypal/disputes.js';

export function createEvidenceDossier({ session, deliveryRecord, milestoneId }) {
  if (!session || !deliveryRecord || !milestoneId) {
    throw new Error('Missing required arguments: session, deliveryRecord, or milestoneId');
  }
  return buildDossier(session, deliveryRecord, milestoneId);
}

export { buildDossier };
