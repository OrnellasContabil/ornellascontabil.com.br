import json, base64, re
from io import BytesIO
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm, mm
from reportlab.platypus import (Paragraph, Frame as PFrame, Spacer, Table,
                                 TableStyle, BaseDocTemplate, PageTemplate,
                                 KeepTogether)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER
from reportlab.lib import colors

# ── Cores ──
AZUL  = colors.HexColor("#5E8FA3")
CINZA = colors.HexColor("#808080")
HDR   = colors.HexColor("#D5E4EC")
W, H  = A4

ML = 1.7*cm; MR = 1.7*cm
LEFT = ML; RIGHT = W - MR; CW = RIGHT - LEFT
LOGO_W = 3.5*cm; LOGO_H = LOGO_W*(3511/6335)
HEADER_H = 1.0*cm + LOGO_H + 3*mm
FOOTER_H = 1.2*cm; BODY_BOT = FOOTER_H + 2*mm

# ── Estilos ──
BODY  = ParagraphStyle('body', fontName='Times-Roman', fontSize=10, leading=15, alignment=TA_JUSTIFY, spaceAfter=5)
SEC   = ParagraphStyle('sec',  fontName='Times-Bold',  fontSize=10, leading=15, alignment=TA_CENTER, spaceBefore=10, spaceAfter=4)
CTR   = ParagraphStyle('ctr',  fontName='Times-Roman', fontSize=10, leading=15, alignment=TA_CENTER)

def bpar(label, text): return Paragraph(f"<b>{label}</b> {text}", BODY)
def sec(txt):          return Paragraph(txt, SEC)

# ── Valor por extenso ──
UNID = ['','um','dois','três','quatro','cinco','seis','sete','oito','nove','dez',
        'onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove']
DEZ  = ['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa']
CENT = ['','cem','duzentos','trezentos','quatrocentos','quinhentos','seiscentos',
        'setecentos','oitocentos','novecentos']

def _ext(n):
    n = int(str(n).replace('.','').replace(',','').split('.')[0]) if n else 0
    if n == 0: return 'zero'
    if n < 20: return UNID[n]
    if n < 100:
        r = DEZ[n//10]
        return r + (' e ' + UNID[n%10] if n%10 else '')
    if n < 1000:
        r = CENT[n//100]
        if n % 100 == 0: return r
        return ('cem' if n//100==1 else CENT[n//100]) + ' e ' + _ext(n%100)
    if n < 1000000:
        mil = n//1000
        r = ('mil' if mil==1 else _ext(mil)+' mil')
        return r + (' e ' + _ext(n%1000) if n%1000 else '')
    return str(n)

def valor_extenso(s):
    s = str(s).strip()
    num = int(re.sub(r'\D','',s) or '0')
    return _ext(num) + (' reais' if num != 1 else ' real')

def fmt_num(n):
    try: return f"{int(n):,.0f}".replace(',','.')
    except: return str(n)

def fmt_brl(n):
    try:
        v = int(n)
        return f"R$ {v:,.0f},00".replace(',','X').replace('.','.',).replace('X','.')
    except: return str(n)

# ── Chrome (cabeçalho + rodapé) ──
def make_chrome(logo_bytes, com_timbrado):
    def draw_chrome(canv, doc):
        # Marca d'água
        if com_timbrado:
            canv.saveState()
            canv.setFillColor(colors.HexColor("#5E8FA3"), alpha=0.055)
            mw=13*cm; mh=mw*(3511/6335)
            from reportlab.lib.utils import ImageReader
            from PIL import Image as PILImage
            import io
            img = PILImage.open(io.BytesIO(logo_bytes))
            ir = ImageReader(img)
            canv.drawImage(ir,(W-mw)/2,(H-mh)/2,width=mw,height=mh,mask='auto',preserveAspectRatio=True)
            canv.restoreState()

            # Logo à direita
            from reportlab.lib.utils import ImageReader
            ir2 = ImageReader(PILImage.open(io.BytesIO(logo_bytes)))
            ly = H - 1.0*cm - LOGO_H
            canv.drawImage(ir2, RIGHT-LOGO_W, ly, width=LOGO_W, height=LOGO_H,
                           mask='auto', preserveAspectRatio=True)

            # Texto à esquerda alinhado verticalmente com logo
            text_y_top = ly + LOGO_H
            canv.setFont("Helvetica-Bold", 8); canv.setFillColor(AZUL)
            canv.drawString(LEFT, text_y_top - 11, "Ornellas Soluções Contábeis")
            canv.setFont("Helvetica", 7); canv.setFillColor(CINZA)
            canv.drawString(LEFT, text_y_top - 22, "CRC/RJ RJ-121169/O-6")

            # Linha azul
            canv.setStrokeColor(AZUL); canv.setLineWidth(1.0)
            canv.line(LEFT, ly - 2*mm, RIGHT, ly - 2*mm)

            # Rodapé azul
            canv.setFillColor(AZUL)
            canv.rect(0, 0, W, FOOTER_H, fill=1, stroke=0)
            canv.setFont("Helvetica", 6.5); canv.setFillColor(colors.white)
            r1 = "Ornellas Soluções Contábeis Ltda  |  CNPJ 25.237.931/0001-39  |  Rua José Clemente, nº 21, Sala 1003, Centro – Niterói/RJ"
            r2 = "contato@ornellascontabil.com.br  |  www.ornellascontabil.com.br  |  CRC/RJ RJ-121169/O-6  |  Matheus Calheiros Ornellas"
            canv.drawCentredString(W/2, FOOTER_H-8, r1)
            canv.drawCentredString(W/2, FOOTER_H-16, r2)
        else:
            # Sem timbrado: só rodapé simples
            canv.setStrokeColor(colors.black); canv.setLineWidth(0.5)
            canv.line(LEFT, FOOTER_H-2, RIGHT, FOOTER_H-2)
            canv.setFont("Helvetica", 7); canv.setFillColor(CINZA)
            canv.drawCentredString(W/2, FOOTER_H-12,
                "Elaborado por: Ornellas Soluções Contábeis Ltda | CRC/RJ RJ-121169/O-6 | Matheus Calheiros Ornellas")
    return draw_chrome

# ── Tabela de quotas ──
def quota_table(socios, capital_total):
    header = [["SÓCIO","QUOTAS","VALOR R$","%"]]
    rows = []
    total_q = sum(int(re.sub(r'\D','',s.get('quotas','0'))or'0') for s in socios)
    total_v = total_q
    for s in socios:
        q = int(re.sub(r'\D','',s.get('quotas','0'))or'0')
        pct = round(q/total_q*100) if total_q else 0
        rows.append([s.get('nome','—'), fmt_num(q), f"{fmt_num(q)},00", f"{pct}%"])
    rows.append([("TOTAL"), fmt_num(total_q), f"{fmt_num(total_v)},00", "100%"])
    data = header + rows
    bold_last = len(data)-1
    colW = [CW*.44, CW*.18, CW*.24, CW*.14]
    t = Table(data, colWidths=colW)
    style = [
        ('FONTNAME',(0,0),(-1,-1),'Times-Roman'),('FONTSIZE',(0,0),(-1,-1),9),
        ('FONTNAME',(0,0),(-1,0),'Times-Bold'),
        ('FONTNAME',(0,bold_last),(-1,bold_last),'Times-Bold'),
        ('BACKGROUND',(0,0),(-1,0),HDR),
        ('BACKGROUND',(0,bold_last),(-1,bold_last),colors.HexColor("#F0F0F0")),
        ('ALIGN',(0,0),(-1,-1),'CENTER'),('VALIGN',(0,0),(-1,-1),'MIDDLE'),
        ('GRID',(0,0),(-1,-1),0.5,colors.black),
        ('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),
    ]
    t.setStyle(TableStyle(style))
    return t

def title_block(tipo_label, nome_emp, tipo_jur):
    data = [[tipo_label.upper()],[f"{nome_emp} {tipo_jur}".upper()]]
    t = Table(data, colWidths=[CW])
    t.setStyle(TableStyle([
        ('FONTNAME',(0,0),(0,0),'Times-Bold'),('FONTSIZE',(0,0),(0,0),13),
        ('FONTNAME',(0,1),(0,1),'Times-Bold'),('FONTSIZE',(0,1),(0,1),12),
        ('ALIGN',(0,0),(0,-1),'CENTER'),
        ('LINEBELOW',(0,1),(0,1),0.5,colors.black),
        ('TOPPADDING',(0,0),(0,-1),4),('BOTTOMPADDING',(0,0),(0,-1),4),
    ]))
    return t

# ── Qualificação do sócio ──
def qualificacao(s):
    nome  = s.get('nome','')
    nac   = s.get('nac','Brasileiro(a)')
    ec    = s.get('ecivil','')
    reg   = s.get('regimecas','')
    if ec.lower() in ('casado(a)','casado','casada') and reg:
        ec = f"{ec} sob o regime de {reg.lower()}"
    prof  = s.get('prof','')
    nasc  = s.get('nasc','')
    nat   = s.get('nat','')
    cpf   = s.get('cpf','')
    rg    = s.get('rg','')
    end   = s.get('end','')
    fem   = s.get('genero','M') == 'F'
    suf   = 'a' if fem else 'o'
    return (f"{nome}, {nac}, {ec}, nascid{suf} em {nasc}, natural de {nat}, "
            f"{prof}, portador{suf} do CPF nº {cpf} e RG nº {rg}, "
            f"residente e domiciliad{suf} na {end}")

def adm_texto(socios):
    adms = [s for s in socios if 'administrador' in s.get('papel','').lower()]
    if not adms: adms = socios[:1]
    if len(adms) == 1:
        s = adms[0]; fem = s.get('genero','M')=='F'; art = 'pela sócia' if fem else 'pelo sócio'
        return f"{art} {s.get('nome','').upper()}"
    nomes = [s.get('nome','').upper() for s in adms]
    return f"pelos sócios {', '.join(nomes[:-1])} e {nomes[-1]}, em conjunto ou isoladamente"

def suf_plural(socios):
    n = len(socios)
    return {'declaram': 'declaram' if n>1 else 'declara',
            'dos_socios': 'dos sócios' if n>1 else 'do sócio',
            'resolver': 'resolvem' if n>1 else 'resolve',
            'constituir': 'constituírem' if n>1 else 'constituir',
            'constituido': 'constituídos(as)' if n>1 else 'constituído(a)'}

# ── Gerador principal ──
def gerar_contrato_social(proc, logo_bytes, com_timbrado=True):
    socios    = proc.get('socios_dados', [{}])
    nome_emp  = proc.get('nome','')
    tipo_jur  = proc.get('tipoJuridico','LTDA')
    capital   = proc.get('capital','')
    capital_n = int(re.sub(r'\D','',capital)or'0')
    cnaes     = proc.get('cnaes',[])
    objeto    = '; '.join(c.get('desc','').capitalize() for c in cnaes) if cnaes else proc.get('objeto','')
    foro      = proc.get('foro','Niterói/RJ')
    cidade    = proc.get('cidade','Niterói')
    uf        = proc.get('uf','RJ')
    data_doc  = proc.get('dataContrato', '')
    adv       = proc.get('advogado')
    sp        = suf_plural(socios)

    from datetime import date
    if not data_doc:
        hoje = date.today()
        meses = ['janeiro','fevereiro','março','abril','maio','junho',
                 'julho','agosto','setembro','outubro','novembro','dezembro']
        data_doc = f"{hoje.day} de {meses[hoje.month-1]} de {hoje.year}"

    # Preâmbulo
    quals = [qualificacao(s) for s in socios]
    preambulo_txt = (
        ', e '.join(quals) +
        f" {sp['resolver']} {sp['constituir']}, como de fato {sp['constituido']} têm, "
        "uma sociedade empresária limitada, que será regida pela Lei nº 10.406/02, "
        "combinado com o Decreto-Lei nº 9.295/46, bem como, pelas seguintes cláusulas e condições:"
    )

    # Assinaturas
    def sign_block():
        rows = []
        for s in socios:
            rows += [
                [f"{'_'*44}"],
                [s.get('nome','').upper()],
                [s.get('papel','Sócio(a)')],
                [f"CPF nº {s.get('cpf','—')}"],
                [''],
            ]
        if adv:
            rows += [
                [f"{'_'*44}"],
                [adv.get('nome','').upper()],
                [f"OAB/{adv.get('uf','RJ')} nº {adv.get('oab','')}"],
                ['Advogado(a) Responsável'],
            ]
        t = Table([[r[0]] for r in rows], colWidths=[CW])
        style_list = [
            ('ALIGN',(0,0),(0,-1),'CENTER'),
            ('FONTSIZE',(0,0),(0,-1),10),
            ('TOPPADDING',(0,0),(0,-1),1),
            ('BOTTOMPADDING',(0,0),(0,-1),1),
        ]
        # Bold nos nomes (linha 1, 5, 9, ...)
        for i,r in enumerate(rows):
            if r[0] and not r[0].startswith('_') and r[0] == r[0].upper() and len(r[0])>3:
                style_list.append(('FONTNAME',(0,i),(0,i),'Times-Bold'))
        t.setStyle(TableStyle(style_list))
        return t

    story = [
        title_block('CONTRATO SOCIAL', nome_emp, tipo_jur),
        Spacer(1,8),
        Paragraph(preambulo_txt, BODY),
        KeepTogether([sec("DENOMINAÇÃO, SEDE, OBJETO E DURAÇÃO"),
            bpar("CLÁUSULA PRIMEIRA –", f"A sociedade girará sob a denominação {nome_emp} {tipo_jur}.")]),
        bpar("CLÁUSULA SEGUNDA –",
             f"A sociedade tem sua sede na {proc.get('enderecoSede',{}).get('logradouro','')}"
             f"{', nº '+proc.get('enderecoSede',{}).get('numero','') if proc.get('enderecoSede',{}).get('numero') else ''}"
             f"{', '+proc.get('enderecoSede',{}).get('complemento','') if proc.get('enderecoSede',{}).get('complemento') else ''}"
             f"{', '+proc.get('enderecoSede',{}).get('bairro','') if proc.get('enderecoSede',{}).get('bairro') else ''}"
             f"{', '+proc.get('enderecoSede',{}).get('cidade','')+'/'+proc.get('enderecoSede',{}).get('uf','') if proc.get('enderecoSede',{}).get('cidade') else proc.get('endereco','endereço não informado')}"
             f"{', CEP '+proc.get('enderecoSede',{}).get('cep','') if proc.get('enderecoSede',{}).get('cep') else ''}"
             f", podendo abrir ou encerrar filiais em qualquer parte do território nacional por deliberação {sp['dos_socios']}."),
        bpar("CLÁUSULA TERCEIRA –",
             f"A sociedade tem por objeto as seguintes atividades: {objeto}."),
        bpar("CLÁUSULA QUARTA –",
             "A sociedade iniciará suas atividades na data do arquivamento deste ato e seu prazo de duração é por tempo indeterminado."),
        KeepTogether([sec("CAPITAL SOCIAL"),
            bpar("CLÁUSULA QUINTA –",
                 f"O capital social é de R$ {capital_n:,.0f},00 ({valor_extenso(capital_n)}), "
                 f"dividido em {fmt_num(capital_n)} ({_ext(capital_n)}) quotas no valor nominal de "
                 f"R$ 1,00 (um real) cada, distribuídas e integralizadas em moeda corrente deste "
                 f"país, assim subscritas:".replace(',','.').replace('X',','))]),
        Spacer(1,4), quota_table(socios, capital_n), Spacer(1,6),
        bpar("PARÁGRAFO PRIMEIRO –",
             f"As quotas são indivisíveis e não poderão ser cedidas ou transferidas a terceiros "
             f"sem o consentimento {sp['dos_socios']}, a quem fica assegurado, em igualdade de "
             f"condições e preço, direito de preferência para a sua aquisição se postas à venda, "
             f"formalizando-se, se realizada a cessão delas, a alteração contratual pertinente "
             f"(art. 1.056, art. 1.057, CC/2002)."),
        bpar("PARÁGRAFO SEGUNDO –",
             "A responsabilidade de cada sócio é restrita ao valor de suas quotas, mas todos "
             "respondem solidariamente pela integralização do capital social, conforme art. 1.052, CC/2002."),
        KeepTogether([sec("ADMINISTRAÇÃO"),
            bpar("CLÁUSULA SEXTA –",
                 f"A sociedade será administrada {adm_texto(socios)}, que exercerá a função de "
                 f"administrador, com poderes de gestão, representação ativa e passiva da "
                 f"sociedade, podendo praticar todos os atos necessários ao funcionamento regular "
                 f"da empresa, inclusive abrir e encerrar contas bancárias, emitir cheques, "
                 f"assinar contratos e demais documentos, não necessitando de outorga especial "
                 f"para os atos de administração ordinária.")]),
        bpar("CLÁUSULA SÉTIMA –",
             "O administrador fará jus a uma retirada mensal a título de pró-labore, cujo valor "
             "será fixado em assembleia e estará sujeito às contribuições previdenciárias na forma "
             "da legislação vigente."),
        KeepTogether([sec("EXERCÍCIO SOCIAL"),
            bpar("CLÁUSULA OITAVA –",
                 "O exercício social terá início em 1° de janeiro e encerrará em 31 de dezembro "
                 "de cada ano, quando serão levantados o balanço patrimonial e demais "
                 "demonstrações financeiras exigidas por lei.")]),
        KeepTogether([sec("DISTRIBUIÇÃO DE LUCROS"),
            bpar("CLÁUSULA NONA –",
                 f"Os lucros e prejuízos apurados ao final de cada exercício social serão "
                 f"distribuídos proporcionalmente às quotas de participação de cada sócio ou "
                 f"destinados à formação de reservas, conforme deliberação {sp['dos_socios']}.")]),
        KeepTogether([sec("DA DISSOLUÇÃO E LIQUIDAÇÃO"),
            bpar("CLÁUSULA DÉCIMA –",
                 f"A sociedade poderá ser dissolvida por deliberação {sp['dos_socios']} ou pelas "
                 f"demais causas previstas em lei. Em caso de dissolução, a liquidação observará "
                 f"o disposto nos arts. 1.102 a 1.112 do Código Civil.")]),
        KeepTogether([sec("DO ENQUADRAMENTO (ME OU EPP)"),
            bpar("CLÁUSULA DÉCIMA PRIMEIRA –",
                 f"O sócio {sp['declaram']} que a sociedade preenche os requisitos estabelecidos "
                 f"pelo art. 3º, I, da Lei Complementar nº 123, de 14 de dezembro de 2006, "
                 f"enquadrando-se como Microempresa, e que não figura em qualquer das hipóteses "
                 f"de exclusão relacionadas no § 4º do art. 3º da mencionada lei.")]),
        KeepTogether([sec("DAS DISPOSIÇÕES GERAIS"),
            bpar("CLÁUSULA DÉCIMA SEGUNDA –",
                 f"O sócio {sp['declaram']}, sob as penas da lei, que não estão impedidos de "
                 f"exercer atividade mercantil ou de administrar sociedade empresária, e que não "
                 f"foram condenados a penas que vedem, ainda que temporariamente, o acesso a "
                 f"cargos públicos ou a exercício de atividade empresarial.")]),
        KeepTogether([sec("DO FORO"),
            bpar("CLÁUSULA DÉCIMA TERCEIRA –",
                 f"Para dirimir quaisquer dúvidas ou controvérsias oriundas do presente contrato, "
                 f"as partes elegem o foro da Comarca de {foro}, com renúncia expressa a qualquer "
                 f"outro, por mais privilegiado que seja.")]),
        KeepTogether([
            Spacer(1,28),
            Paragraph(f"{cidade}/{uf}, {data_doc}.", CTR),
            Spacer(1,44),
            sign_block(),
        ]),
    ]

    buf = BytesIO()
    chrome_fn = make_chrome(logo_bytes, com_timbrado)

    top_margin = (HEADER_H + 2*mm) if com_timbrado else 2*cm

    class Doc(BaseDocTemplate):
        def __init__(self):
            super().__init__(buf, pagesize=A4,
                             leftMargin=LEFT, rightMargin=MR,
                             topMargin=top_margin, bottomMargin=BODY_BOT)
            frame = PFrame(LEFT, BODY_BOT, CW, H-top_margin-BODY_BOT,
                           leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
            self.addPageTemplates([PageTemplate(id='main',frames=[frame],onPage=chrome_fn)])

    Doc().build(story)
    return buf.getvalue()


# ── Handler Netlify ──
def handler(event, context):
    try:
        body = json.loads(event.get('body') or '{}')
        proc         = body.get('proc', {})
        com_timbrado = body.get('comTimbrado', True)
        logo_b64     = body.get('logoB64', '')

        logo_bytes = base64.b64decode(logo_b64) if logo_b64 else b''

        pdf_bytes = gerar_contrato_social(proc, logo_bytes, com_timbrado)
        pdf_b64   = base64.b64encode(pdf_bytes).decode()

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/pdf',
                'Content-Disposition': f'attachment; filename="Contrato_{proc.get("nome","Empresa").replace(" ","_")}.pdf"',
                'Access-Control-Allow-Origin': '*',
            },
            'body': pdf_b64,
            'isBase64Encoded': True,
        }
    except Exception as e:
        return {'statusCode': 500, 'body': json.dumps({'error': str(e)})}
