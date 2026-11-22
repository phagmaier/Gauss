"""Write the illustrated PDF for the dev seed on the project's development venv."""

import sys

from reportlab.pdfgen.canvas import Canvas


pdf = Canvas(sys.argv[1], pagesize=(432, 432), invariant=1)
pdf.setTitle("Counting with Pictures")
pdf.setAuthor("Gauss")


def heading(key, title):
    pdf.bookmarkPage(key)
    pdf.addOutlineEntry(title, key)
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(32, 380, title)
    pdf.setFont("Helvetica", 13)


heading("squares", "Five points in four squares")
pdf.drawString(32, 344, "Place five points in a square divided into four equal parts.")
pdf.drawString(32, 322, "Two points must share a square.")
pdf.beginForm("grid", 115, 75, 317, 277)
pdf.rect(116, 76, 200, 200)
pdf.line(216, 76, 216, 276)
pdf.line(116, 176, 316, 176)
for point in [(146, 104), (184, 143), (253, 126), (191, 217), (277, 241)]:
    pdf.circle(*point, 4, fill=1)
pdf.endForm()
pdf.doForm("grid")
pdf.showPage()

heading("hands", "Counting handshakes")
pdf.drawString(32, 344, "Each edge joins two people who shook hands.")
pdf.drawString(32, 322, "Counting the edges at every person counts each edge twice.")
pdf.beginForm("graph", 110, 90, 322, 254)
points = [(116, 96), (316, 96), (216, 248)]
for i, point in enumerate(points):
    pdf.line(*point, *points[i - 1])
    pdf.circle(*point, 5, fill=1)
pdf.endForm()
pdf.doForm("graph")
pdf.showPage()
pdf.save()
