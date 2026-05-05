const PDFDocument = require("pdfkit");

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const PRIMARY = "#00D4AA";
const BLACK = "#000000";
const GREY = "#555555";
const LIGHT_GREY = "#AAAAAA";
const PAGE_WIDTH = 595.28; // A4
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function formatDate(isoStr) {
  const d = new Date(isoStr);
  return d.toISOString().slice(0, 10);
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDistance(meters) {
  return (meters / 1000).toFixed(1) + " km";
}

function drawHRule(doc, y) {
  doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).strokeColor(LIGHT_GREY).lineWidth(0.5).stroke();
}

function drawPage1(doc, data) {
  const { user, period, summary } = data;

  // Header band
  doc.rect(0, 0, PAGE_WIDTH, 80).fill(PRIMARY);
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(22).text("PurePedal", MARGIN, 22);
  doc.fontSize(11).font("Helvetica").text("Air-quality-aware cycling", MARGIN, 50);

  // Title
  doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(18)
    .text(`Monthly Health Report — ${period.label}`, MARGIN, 100, { width: CONTENT_WIDTH });

  // User + generation date
  doc.font("Helvetica").fontSize(10).fillColor(GREY)
    .text(`Rider: ${user.display_name || user.email}`, MARGIN, 130)
    .text(`Generated: ${new Date().toISOString().slice(0, 10)}`, MARGIN, 145);

  drawHRule(doc, 165);

  // Key stats 2×3 grid
  const stats = [
    ["Total rides", String(summary.totalRides)],
    ["Total distance", formatDistance(summary.totalDistance_m)],
    ["Total duration", formatDuration(summary.totalDuration_seconds)],
    ["Average AQI exposure", String(summary.weightedAvgAqi.toFixed(1))],
    ["Cleanest ride", summary.cleanestRide
      ? `${formatDate(summary.cleanestRide.started_at)} (AQI ${summary.cleanestRide.avg_aqi.toFixed(0)})`
      : "N/A"],
    ["Most polluted ride", summary.mostPollutedRide
      ? `${formatDate(summary.mostPollutedRide.started_at)} (AQI ${summary.mostPollutedRide.avg_aqi.toFixed(0)})`
      : "N/A"],
  ];

  const colW = CONTENT_WIDTH / 2;
  let statY = 185;
  for (let i = 0; i < stats.length; i++) {
    const col = i % 2;
    const x = MARGIN + col * colW;
    if (col === 0 && i > 0) statY += 40;
    doc.font("Helvetica").fontSize(9).fillColor(GREY).text(stats[i][0], x, statY);
    doc.font("Helvetica-Bold").fontSize(13).fillColor(PRIMARY).text(stats[i][1], x, statY + 12);
  }

  drawHRule(doc, statY + 55);

  // WHO comparison
  const whoY = statY + 70;
  const whoText = `Your average AQI exposure of ${summary.weightedAvgAqi.toFixed(1)} is ` +
    `${summary.ratioToWho.toFixed(2)}× the WHO 24-hour guideline.`;
  doc.font("Helvetica").fontSize(10).fillColor(BLACK).text(whoText, MARGIN, whoY, { width: CONTENT_WIDTH });

  const compMap = {
    below_guideline: { label: "Below WHO guideline — excellent exposure", color: "#28A745" },
    moderate_concern: { label: "1–2× WHO guideline — moderate concern", color: "#FFC107" },
    high_concern: { label: "Above 2× WHO guideline — high concern", color: "#DC3545" },
  };
  const comp = compMap[summary.whoComparison] || compMap.moderate_concern;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(comp.color)
    .text(comp.label, MARGIN, whoY + 18, { width: CONTENT_WIDTH });
}

function drawPage2(doc, data) {
  doc.addPage();
  const { period, weeklyBreakdown } = data;

  doc.fillColor(PRIMARY).font("Helvetica-Bold").fontSize(16)
    .text(`Weekly Breakdown — ${period.label}`, MARGIN, MARGIN);
  drawHRule(doc, MARGIN + 28);

  const headers = ["Week", "Rides", "Distance", "Avg AQI", "Rating"];
  const colWidths = [160, 50, 90, 80, 115];
  let y = MARGIN + 45;

  // Table header
  let x = MARGIN;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(BLACK);
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x, y, { width: colWidths[i] });
    x += colWidths[i];
  }
  y += 16;
  drawHRule(doc, y);
  y += 8;

  doc.font("Helvetica").fontSize(9).fillColor(BLACK);
  for (const wk of weeklyBreakdown) {
    x = MARGIN;
    const label = `Week ${wk.weekNumber} (${wk.startDate} – ${wk.endDate})`;
    const row = [
      label,
      String(wk.rides),
      formatDistance(wk.totalDistance_m),
      String(wk.avgAqi.toFixed(1)),
      wk.rating.charAt(0).toUpperCase() + wk.rating.slice(1),
    ];
    for (let i = 0; i < row.length; i++) {
      doc.text(row[i], x, y, { width: colWidths[i] });
      x += colWidths[i];
    }
    y += 18;
    if (y > doc.page.height - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  }
}

function drawRideLogPages(doc, data) {
  const { period, rides } = data;
  const PAGE_SIZE = 20;
  const headers = ["Date", "Route", "Distance", "Duration", "AQI"];
  const colWidths = [80, 175, 80, 80, 80];

  for (let page = 0; page < Math.ceil(rides.length / PAGE_SIZE); page++) {
    doc.addPage();
    doc.fillColor(PRIMARY).font("Helvetica-Bold").fontSize(16)
      .text(`Ride Log — ${period.label}${page > 0 ? ` (cont.)` : ""}`, MARGIN, MARGIN);
    drawHRule(doc, MARGIN + 28);

    let y = MARGIN + 45;
    let x = MARGIN;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(BLACK);
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], x, y, { width: colWidths[i] });
      x += colWidths[i];
    }
    y += 16;
    drawHRule(doc, y);
    y += 8;

    const batch = rides.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    doc.font("Helvetica").fontSize(9).fillColor(BLACK);
    for (const ride of batch) {
      x = MARGIN;
      const row = [
        formatDate(ride.started_at),
        ride.savedRouteName || "—",
        formatDistance(ride.distance_m),
        formatDuration(ride.duration_seconds),
        ride.avg_aqi.toFixed(0),
      ];
      for (let i = 0; i < row.length; i++) {
        doc.text(row[i], x, y, { width: colWidths[i] });
        x += colWidths[i];
      }
      y += 16;
    }
  }
}

function drawFooterPage(doc) {
  doc.addPage();
  doc.fillColor(PRIMARY).font("Helvetica-Bold").fontSize(14).text("About This Report", MARGIN, MARGIN);
  drawHRule(doc, MARGIN + 22);

  doc.font("Helvetica").fontSize(10).fillColor(BLACK)
    .text("Generated by PurePedal", MARGIN, MARGIN + 38)
    .text("Data sourced from World Air Quality Index (WAQI)", MARGIN, MARGIN + 55)
    .text(
      "Disclaimer: This report is for informational purposes only and does not constitute medical advice.",
      MARGIN, MARGIN + 80,
      { width: CONTENT_WIDTH }
    );
}

function generateMonthlyReport(userId, month, year, data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawPage1(doc, data);
    drawPage2(doc, data);
    drawRideLogPages(doc, data);
    drawFooterPage(doc);

    doc.end();
  });
}

module.exports = { generateMonthlyReport };
