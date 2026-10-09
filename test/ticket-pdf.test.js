import test from "node:test";
import assert from "node:assert/strict";
import { renderTicketPdf } from "../src/services/ticketPdf.js";

test("renderTicketPdf creates a readable PDF with a QR ticket", async () => {
  const booking = {
    _id: "507f1f77bcf86cd799439011",
    status: "confirmed",
    checkedInAt: null,
    customerSnapshot: { name: "Mohammad Al Nablsi" },
    tripId: {
      titleEn: "Sukar",
      vesselName: "Sukar",
      departureLocation: { name: "Aqaba Marina" }
    },
    providerId: { businessName: "Aladdin Yachts & Marine Tours" },
    departureId: { startsAt: new Date("2026-10-11T15:00:00.000Z"), status: "scheduled" },
    adults: 2,
    children: 2,
    mealPlan: "with_buffet",
    pricing: { grossAmount: 54, currency: "JOD" }
  };

  const pdf = await renderTicketPdf({ booking, token: "test-token" });
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok(pdf.length > 3000);
});
