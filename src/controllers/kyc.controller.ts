import { type Response } from 'express';
import { getUserById } from '../repositories/user.repository';
import { AuthenticatedRequest } from '../types/authenticatedRequest';

interface KYCStatusResponse {
  kycStatus: boolean;
  applicantId?: string;
  reviewStatus?: string;
  reviewAnswer?: string;
  reviewRejectType?: string;
}

export class KYCController {
  async checkKYCStatus(req: AuthenticatedRequest, res: Response) {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let response: KYCStatusResponse = { kycStatus: false };

    if (user.applicant_id) {
      response = {
        kycStatus: user.applicant_review_status === "completed" && user.applicant_review_answer === "GREEN",
        reviewStatus: user.applicant_review_status,
        reviewAnswer: user.applicant_review_answer,
        reviewRejectType: user.applicant_review_reject_type,
        applicantId: user.applicant_id,
      };
    }

    return res.json(response);
  }
}

export const kycController = new KYCController();