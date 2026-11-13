"""Branded client quotation PDF (ReportLab – pure Python, no system deps)."""
from __future__ import annotations

import io
from datetime import date

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

BRAND = colors.HexColor("#0E7490")
INK = colors.HexColor("#0F172A")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#E2E8F0")


def _inr(v: float) -> str:
    # Indian digit grouping: 12,34,567.89
    neg = v < 0
    v = abs(round(v, 2))
    whole, frac = f"{v:.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{'-' if neg else ''}Rs. {whole}.{frac}"


def quote_pdf(project: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm,
                            title=f"Quotation – {project['name']}", author="VitroStack")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=20, textColor=BRAND, alignment=0, spaceAfter=2)
    small = ParagraphStyle("s", parent=ss["Normal"], fontSize=8.5, textColor=MUTED, leading=11)
    body = ParagraphStyle("b", parent=ss["Normal"], fontSize=9.5, textColor=INK, leading=13)
    h2 = ParagraphStyle("h2", parent=ss["Heading3"], fontSize=11, textColor=INK, spaceBefore=10, spaceAfter=4)

    q, bom, wind, cut, sil = project["quote"], project["bom"], project.get("wind") or {}, project.get("cutting") or {}, project.get("silicone") or {}
    story = [
        Paragraph("VitroStack", h1),
        Paragraph("Structural glazing quotation", small),
        Spacer(1, 8),
        Table([
            [Paragraph(f"<b>Project</b><br/>{project['name']}", body),
             Paragraph(f"<b>Client</b><br/>{project.get('client') or '—'}", body),
             Paragraph(f"<b>Date</b><br/>{date.today():%d %b %Y}", body),
             Paragraph(f"<b>Ref</b><br/>VS-{project['id'][:6].upper()}", body)],
        ], colWidths=[60 * mm, 50 * mm, 34 * mm, 34 * mm],
            style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                              ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                              ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                              ("PADDING", (0, 0), (-1, -1), 6)])),
        Paragraph("Engineering basis", h2),
        Paragraph(
            f"{project['city']}, installation height {project['building_height_m']} m, "
            f"IS 875 (Part 3) design wind pressure <b>{wind.get('design_pressure_kpa', '—')} kPa</b> "
            f"(Vb {wind.get('factors', {}).get('Vb', '—')} m/s, k2 {wind.get('factors', {}).get('k2', '—')}). "
            f"Glass: <b>{project['glass_label']}</b>, max utilisation {round(100 * wind.get('max_utilisation', 0))}%. "
            f"Structural silicone bite {sil.get('bite_mm', '—')} mm × {sil.get('glueline_thickness_mm', '—')} mm glueline. "
            f"{project['panel_count']} panels, {bom['panel_area_m2']} m², optimized scrap "
            f"{cut.get('totals', {}).get('scrap_pct', '—')}%.", body),
        Paragraph("Bill of materials", h2),
    ]
    rows = [["#", "Item", "Qty", "Unit", "Rate", "Amount"]]
    for i, ln in enumerate(bom["lines"], 1):
        rows.append([str(i), Paragraph(ln["item"], body), f"{ln['qty']:g}", ln["unit"],
                     _inr(ln["rate"]), _inr(ln["amount"])])
    t = Table(rows, colWidths=[8 * mm, 78 * mm, 16 * mm, 16 * mm, 30 * mm, 30 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5), ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 1), (-1, -1), 0.25, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    story.append(Spacer(1, 8))
    totals = [
        ["Subtotal", _inr(q["subtotal"])],
        [f"GST @ {q['gst_percent']:g}%", _inr(q["gst"])],
        ["Grand total", _inr(q["grand_total"])],
    ]
    tt = Table(totals, colWidths=[40 * mm, 36 * mm], hAlign="RIGHT")
    tt.setStyle(TableStyle([
        ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"), ("LINEABOVE", (0, -1), (-1, -1), 1, BRAND),
        ("TEXTCOLOR", (0, -1), (-1, -1), BRAND), ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(tt)
    story += [
        Paragraph("Terms", h2),
        Paragraph("Validity 15 days. 50% advance, 40% on delivery, 10% on handover. Prices ex-works; "
                  "scaffolding and access by client. Structural values are computed by deterministic "
                  "IS 875 engines and are subject to final facade-engineer sign-off.", small),
    ]
    doc.build(story)
    return buf.getvalue()
