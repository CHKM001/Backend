-- DropIndex
DROP INDEX "referral_conversions_manualReviewRequired_idx";

-- Remove fraud detection fields from referral_conversions
ALTER TABLE "referral_conversions" DROP COLUMN "fraudCheckScore";
ALTER TABLE "referral_conversions" DROP COLUMN "fraudCheckFlags";
ALTER TABLE "referral_conversions" DROP COLUMN "fraudCheckDetails";
ALTER TABLE "referral_conversions" DROP COLUMN "manualReviewRequired";
ALTER TABLE "referral_conversions" DROP COLUMN "manualReviewRejected";
ALTER TABLE "referral_conversions" DROP COLUMN "reviewedBy";
ALTER TABLE "referral_conversions" DROP COLUMN "reviewedAt";
ALTER TABLE "referral_conversions" DROP COLUMN "rejectionReason";
