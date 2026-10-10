import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { deriveTicketLifecycle } from "./ticketLifecycle.js";

function safeText(value, fallback = "-") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const ascii = raw
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return ascii || fallback;
}

function formatDate(value) {
  if (!value) return "TBA";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Amman",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function money(value, currency = "JOD") {
  return `${Number(value || 0).toFixed(2)} ${safeText(currency, "JOD")}`;
}

export function ticketPdfPresentation(booking) {
  const lifecycle = deriveTicketLifecycle(booking);
  const labels = {
    ready: "READY FOR CHECK-IN",
    checked_in: "USED",
    booking_cancelled: "BOOKING CANCELLED",
    refunded: "REFUNDED",
    departure_cancelled: "DEPARTURE CANCELLED",
    trip_completed: "TRIP COMPLETED",
    unavailable: "TICKET UNAVAILABLE"
  };
  return {
    lifecycle,
    status: labels[lifecycle.state] || "TICKET UNAVAILABLE",
    activeQr: lifecycle.usable
  };
}

function detail(doc, label, value, x, y, width = 180) {
  doc.font("Helvetica").fontSize(8).fillColor("#7b8c99").text(label.toUpperCase(), x, y, { width });
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#15364b").text(safeText(value), x, y + 11, { width, height: 32, ellipsis: true });
}

export async function renderTicketPdf({ booking, token }) {
  if (!booking || !token) throw new Error("booking and token are required");

  const trip = booking.tripId || {};
  const provider = booking.providerId || {};
  const departure = booking.departureId || {};
  const location = trip.departureLocation || {};
  const ref = `SG-${String(booking._id).slice(-8).toUpperCase()}`;
  const customerName = booking.customerSnapshot?.name || booking.customerId?.name || "Guest";
  const title = trip.titleEn || trip.titleAr || "SeaGo Trip";
  const vessel = trip.vesselName || null;
  const presentation = ticketPdfPresentation(booking);
  const status = presentation.status;

  const qrDataUrl = presentation.activeQr
    ? await QRCode.toDataURL(`SG2:${token}`, { errorCorrectionLevel: "M", margin: 1, width: 360 })
    : null;
  const qrBuffer = qrDataUrl ? Buffer.from(qrDataUrl.split(",")[1], "base64") : null;

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: "A5",
      margin: 0,
      info: {
        Title: `Aqaba SeaGo Ticket ${ref}`,
        Author: "Aqaba SeaGo",
        Subject: "Booking ticket"
      }
    });

    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width;

    doc.rect(0, 0, pageWidth, doc.page.height).fill("#f4f8fb");
    doc.rect(0, 0, pageWidth, 90).fill("#0b3558");
    doc.font("Helvetica-Bold").fontSize(22).fillColor("#ffffff").text("Aqaba SeaGo", 30, 27);
    doc.font("Helvetica").fontSize(9).fillColor("#b9d8e8").text("AQABA · JORDAN", 31, 56, { characterSpacing: 1.4 });

    doc.roundedRect(26, 108, pageWidth - 52, 55, 12).fill("#ffffff");
    doc.font("Helvetica").fontSize(8).fillColor("#7b8c99").text("BOOKING REFERENCE", 42, 122);
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#15364b").text(ref, 42, 136);

    const statusColor = presentation.activeQr ? "#027a48" : presentation.lifecycle.used ? "#175cd3" : "#b42318";
    doc.font("Helvetica-Bold").fontSize(10).fillColor(statusColor).text(status, pageWidth - 175, 132, { width: 125, align: "right" });

    doc.font("Helvetica-Bold").fontSize(19).fillColor("#15364b").text(safeText(title, "SeaGo Trip"), 30, 184, {
      width: pageWidth - 60,
      height: 48,
      ellipsis: true
    });
    doc.font("Helvetica").fontSize(9).fillColor("#6f8290").text(
      provider.businessName ? `Operated by ${safeText(provider.businessName)}` : "Aqaba SeaGo marine experience",
      30,
      226,
      { width: pageWidth - 60, height: 24, ellipsis: true }
    );

    detail(doc, "Customer", customerName, 30, 265, 205);
    detail(doc, "Departure", formatDate(departure.startsAt), 30, 313, 205);
    detail(doc, "Guests", `${booking.adults || 0} adult(s) · ${booking.children || 0} child(ren)`, 30, 361, 205);
    detail(doc, "Package", booking.mealPlan === "with_buffet" ? "Open buffet included" : "Without buffet", 30, 409, 205);
    detail(doc, "Total", money(booking.pricing?.grossAmount, booking.pricing?.currency), 30, 457, 205);

    if (vessel) detail(doc, "Vessel", vessel, 246, 265, 143);
    if (location.name) detail(doc, "Departure point", location.name, 246, 313, 143);

    if (qrBuffer) {
      doc.roundedRect(249, 358, 140, 140, 12).fill("#ffffff");
      doc.image(qrBuffer, 259, 368, { width: 120, height: 120 });
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#15364b").text("SHOW AT CHECK-IN", 249, 503, { width: 140, align: "center" });
    } else {
      doc.roundedRect(249, 372, 140, 84, 12).fill("#fff2f0");
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#b42318").text(status, 255, 393, { width: 128, align: "center" });
      doc.font("Helvetica").fontSize(8).fillColor("#7b8c99").text("QR check-in unavailable", 259, 423, { width: 120, align: "center" });
    }

    doc.moveTo(30, 535).lineTo(pageWidth - 30, 535).strokeColor("#dbe7ee").stroke();
    doc.font("Helvetica").fontSize(8).fillColor("#7b8c99").text(
      presentation.activeQr
        ? "Keep this ticket available for check-in. Ticket validity is verified live by Aqaba SeaGo."
        : "This booking remains in your history, but its QR is not available for check-in.",
      30,
      548,
      { width: pageWidth - 60, align: "center" }
    );

    doc.end();
  });
}
