-- Add fraud detection fields to referral_conversions (#490)
ALTER TABLE "referral_conversions" ADD COLUMN "fraudCheckScore" INTEGER;
ALTER TABLE "referral_conversions" ADD COLUMN "fraudCheckFlags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "referral_conversions" ADD COLUMN "fraudCheckDetails" JSONB;
ALTER TABLE "referral_conversions" ADD COLUMN "manualReviewRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "referral_conversions" ADD COLUMN "manualReviewRejected" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "referral_conversions" ADD COLUMN "reviewedBy" TEXT;
ALTER TABLE "referral_conversions" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "referral_conversions" ADD COLUMN "rejectionReason" TEXT;

-- CreateIndex
CREATE INDEX "referral_conversions_manualReviewRequired_idx" ON "referral_conversions"("manualReviewRequired");
