// netlify/functions/gerar_pdf.js
// Geração de Contrato Social em PDF — reescrito em Node (pdfkit), substituindo a
// versão Python (reportlab) que não é suportada pelo runtime de Functions da Netlify.
//
// IMPORTANTE — fontes embutidas (sem arquivos .afm externos):
// O pdfkit normalmente lê as métricas de fonte padrão (Helvetica, Times etc.) de
// arquivos .afm no disco, em tempo de execução: fs.readFileSync(__dirname + '/data/Helvetica.afm').
// No bundle da Netlify (esbuild), esses arquivos não são empacotados automaticamente
// (são lidos dinamicamente, não via require/import), causando erro ENOENT em runtime.
// Para evitar depender de subir esses arquivos manualmente para o repositório (processo
// sujeito a falhas de upload e de tradução automática do navegador corrompendo o
// conteúdo), o conteúdo desses 4 arquivos .afm (os únicos usados neste documento:
// Helvetica, Helvetica-Bold, Times-Roman, Times-Bold) está embutido como texto no
// arquivo afm_data.js, e interceptamos fs.readFileSync para servir esse conteúdo
// em memória sempre que o pdfkit pedir um desses arquivos .afm.
const fs = require('fs');
const AFM_DATA = require('./afm_data.js');
const _origReadFileSync = fs.readFileSync;
fs.readFileSync = function (filePath, ...args) {
  const pathStr = String(filePath);
  if (pathStr.endsWith('.afm')) {
    const fileName = pathStr.split(/[\\/]/).pop();
    if (AFM_DATA[fileName]) {
      return AFM_DATA[fileName];
    }
  }
  return _origReadFileSync.call(fs, filePath, ...args);
};

const PDFDocument = require('pdfkit');

// ── Constantes de layout (A4, em pontos: 1cm = 28.3465pt) ──
const CM = 28.3465;
const MM = 2.83465;
const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;

const AZUL = '#5E8FA3';
const CINZA = '#808080';
const HDR_BG = '#D5E4EC';

const ML = 1.7 * CM;
const MR = 1.7 * CM;
const LEFT = ML;
const RIGHT = PAGE_W - MR;
const CW = RIGHT - LEFT;

const LOGO_W = 3.5 * CM;
const LOGO_H = LOGO_W * (3511 / 6335);
const HEADER_H = 1.0 * CM + LOGO_H + 3 * MM;
const FOOTER_H = 1.2 * CM;
const BODY_BOTTOM = FOOTER_H + 2 * MM;

// ════════════════════════════════════════════════════════════
// Valor por extenso
// ════════════════════════════════════════════════════════════
const UNID = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENT = ['', 'cem', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos',
  'setecentos', 'oitocentos', 'novecentos'];

function ext(n) {
  n = Math.trunc(n) || 0;
  if (n === 0) return 'zero';
  if (n < 20) return UNID[n];
  if (n < 100) {
    const r = DEZ[Math.floor(n / 10)];
    return r + (n % 10 ? ' e ' + UNID[n % 10] : '');
  }
  if (n < 1000) {
    const c = Math.floor(n / 100);
    if (n % 100 === 0) return c === 1 ? 'cem' : CENT[c];
    return (c === 1 ? 'cem' : CENT[c]) + ' e ' + ext(n % 100);
  }
  if (n < 1000000) {
    const mil = Math.floor(n / 1000);
    const r = mil === 1 ? 'mil' : ext(mil) + ' mil';
    return r + (n % 1000 ? ' e ' + ext(n % 1000) : '');
  }
  return String(n);
}

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

function valorExtenso(s) {
  const num = parseInt(onlyDigits(s) || '0', 10);
  return ext(num) + (num !== 1 ? ' reais' : ' real');
}

function fmtNum(n) {
  const v = parseInt(n, 10);
  if (isNaN(v)) return String(n);
  return v.toLocaleString('pt-BR').replace(/,/g, '.');
}

// ════════════════════════════════════════════════════════════
// Qualificação / textos auxiliares
// ════════════════════════════════════════════════════════════
function qualificacao(s) {
  const nome = s.nome || '';
  const nac = s.nac || 'Brasileiro(a)';
  let ec = s.ecivil || '';
  const reg = s.regimecas || '';
  if (['casado(a)', 'casado', 'casada'].includes(ec.toLowerCase()) && reg) {
    ec = `${ec} sob o regime de ${reg.toLowerCase()}`;
  }
  const prof = s.prof || '';
  const nasc = s.nasc || '';
  const nat = s.nat || '';
  const cpf = s.cpf || '';
  const rg = s.rg || '';
  const end = s.end || '';
  const fem = (s.genero || 'M') === 'F';
  const suf = fem ? 'a' : 'o';
  return `${nome}, ${nac}, ${ec}, nascid${suf} em ${nasc}, natural de ${nat}, ` +
    `${prof}, portador${suf} do CPF nº ${cpf} e RG nº ${rg}, ` +
    `residente e domiciliad${suf} na ${end}`;
}

function admTexto(socios) {
  let adms = socios.filter(s => (s.papel || '').toLowerCase().includes('administrador'));
  if (!adms.length) adms = socios.slice(0, 1);
  if (adms.length === 1) {
    const s = adms[0];
    const fem = (s.genero || 'M') === 'F';
    const art = fem ? 'pela sócia' : 'pelo sócio';
    return `${art} ${(s.nome || '').toUpperCase()}`;
  }
  const nomes = adms.map(s => (s.nome || '').toUpperCase());
  return `pelos sócios ${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}, em conjunto ou isoladamente`;
}

function sufPlural(socios) {
  const n = socios.length;
  return {
    declaram: n > 1 ? 'declaram' : 'declara',
    dos_socios: n > 1 ? 'dos sócios' : 'do sócio',
    resolver: n > 1 ? 'resolvem' : 'resolve',
    constituir: n > 1 ? 'constituírem' : 'constituir',
    constituido: n > 1 ? 'constituídos(as)' : 'constituído(a)',
  };
}

// ════════════════════════════════════════════════════════════
// Desenho de cabeçalho/rodapé (chrome) em cada página
// ════════════════════════════════════════════════════════════
// NOTA IMPORTANTE: o pdfkit usa origem no canto SUPERIOR-esquerdo (y cresce para baixo).
// O ReportLab (Python original) usa origem no canto INFERIOR-esquerdo (y cresce para cima).
// Todas as coordenadas Y abaixo foram recalculadas para o sistema do pdfkit.
//
// NOTA TÉCNICA CRÍTICA: doc.text() com y absoluto, quando cai dentro da área de margem
// (cabeçalho/rodapé), é interpretado pelo LineWrapper interno do pdfkit como "overflow"
// e dispara uma nova página automaticamente — mesmo a posição sendo intencional. Passar
// `height: 1` nas opções neutraliza essa checagem (ver doc.maxY = startY + options.height),
// permitindo desenhar livremente dentro das margens sem efeitos colaterais de paginação.
const NO_OVERFLOW = { height: 1 };

function drawChrome(doc, logoBuffer, comTimbrado) {
  if (comTimbrado && logoBuffer) {
    // Marca d'água central
    doc.save();
    doc.opacity(0.06);
    const mw = 13 * CM;
    const mh = mw * (3511 / 6335);
    try {
      doc.image(logoBuffer, (PAGE_W - mw) / 2, (PAGE_H - mh) / 2, { width: mw, height: mh });
    } catch (e) { /* ignora se o logo não puder ser desenhado */ }
    doc.opacity(1);
    doc.restore();

    // Logo no canto superior direito (topo = y pequeno no pdfkit)
    const logoY = 1.0 * CM;
    try {
      doc.image(logoBuffer, RIGHT - LOGO_W, logoY, { width: LOGO_W, height: LOGO_H });
    } catch (e) { /* ignora */ }

    // Texto à esquerda, alinhado verticalmente com o topo da logo
    doc.font('Helvetica-Bold').fontSize(8).fillColor(AZUL);
    doc.text('Ornellas Soluções Contábeis', LEFT, logoY + 2, { width: CW - LOGO_W - 10, lineBreak: false, ...NO_OVERFLOW });
    doc.font('Helvetica').fontSize(7).fillColor(CINZA);
    doc.text('CRC/RJ RJ-121169/O-6', LEFT, logoY + 14, { width: CW - LOGO_W - 10, lineBreak: false, ...NO_OVERFLOW });

    // Linha azul, logo abaixo da logo
    const lineY = logoY + LOGO_H + 2 * MM;
    doc.save();
    doc.strokeColor(AZUL).lineWidth(1.0);
    doc.moveTo(LEFT, lineY).lineTo(RIGHT, lineY).stroke();
    doc.restore();

    // Rodapé azul (faixa inferior)
    doc.save();
    doc.rect(0, PAGE_H - FOOTER_H, PAGE_W, FOOTER_H).fill(AZUL);
    doc.restore();
    doc.font('Helvetica').fontSize(6.5).fillColor('#FFFFFF');
    const r1 = 'Ornellas Soluções Contábeis Ltda  |  CNPJ 25.237.931/0001-39  |  Rua José Clemente, nº 21, Sala 1003, Centro – Niterói/RJ';
    const r2 = 'contato@ornellascontabil.com.br  |  www.ornellascontabil.com.br  |  CRC/RJ RJ-121169/O-6  |  Matheus Calheiros Ornellas';
    doc.text(r1, LEFT, PAGE_H - FOOTER_H + 5, { width: CW, align: 'center', lineBreak: false, ...NO_OVERFLOW });
    doc.text(r2, LEFT, PAGE_H - FOOTER_H + 14, { width: CW, align: 'center', lineBreak: false, ...NO_OVERFLOW });
  } else {
    // Sem timbrado: rodapé simples
    doc.save();
    doc.strokeColor('#000000').lineWidth(0.5);
    doc.moveTo(LEFT, PAGE_H - FOOTER_H + 4).lineTo(RIGHT, PAGE_H - FOOTER_H + 4).stroke();
    doc.restore();
    doc.font('Helvetica').fontSize(7).fillColor(CINZA);
    doc.text(
      'Elaborado por: Ornellas Soluções Contábeis Ltda | CRC/RJ RJ-121169/O-6 | Matheus Calheiros Ornellas',
      LEFT, PAGE_H - FOOTER_H + 9, { width: CW, align: 'center', lineBreak: false, ...NO_OVERFLOW }
    );
  }
}

// ════════════════════════════════════════════════════════════
// Helpers de escrita de texto corrido / seções / tabela
// ════════════════════════════════════════════════════════════
function ensureSpace(doc, neededHeight) {
  // O pdfkit já pagina automaticamente texto que excede o fim da página (doc.text com
  // word-wrap). Só forçamos uma nova página quando um bloco "atômico" (tabela, assinatura)
  // não cabe no espaço restante da página atual.
  const bottomLimit = doc.page.height - doc.page.margins.bottom;
  if (doc.y + neededHeight > bottomLimit) {
    doc.addPage();
  }
}

function writeBodyParagraph(doc, text, topMargin) {
  doc.x = LEFT;
  doc.font('Times-Roman').fontSize(10);
  doc.text(text, { width: CW, align: 'justify', lineGap: 2 });
  doc.moveDown(0.4);
}

function writeBoldLeadParagraph(doc, label, text, topMargin) {
  // Escreve "LABEL texto" com o label em negrito e o resto em fonte normal, fluindo
  // como um único parágrafo contínuo. O pdfkit já pagina automaticamente textos que
  // cruzam o fim da página quando usamos continued — não precisamos (e não devemos)
  // forçar addPage manualmente aqui, pois isso causava duplicação de páginas.
  doc.x = LEFT;
  doc.font('Times-Bold').fontSize(10);
  doc.text(label + ' ', { width: CW, align: 'justify', lineGap: 2, continued: true });
  doc.font('Times-Roman').fontSize(10);
  doc.text(text, { width: CW, align: 'justify', lineGap: 2 });
  doc.moveDown(0.4);
}

function writeSectionTitle(doc, txt, topMargin) {
  ensureSpace(doc, 24);
  doc.moveDown(0.5);
  doc.x = LEFT;
  doc.font('Times-Bold').fontSize(10);
  doc.text(txt, { width: CW, align: 'center' });
  doc.moveDown(0.3);
}

function drawTitleBlock(doc, tipoLabel, nomeEmp, tipoJur, topMargin) {
  ensureSpace(doc, 60);
  doc.x = LEFT;
  doc.font('Times-Bold').fontSize(13);
  doc.text(tipoLabel.toUpperCase(), { width: CW, align: 'center' });
  doc.moveDown(0.2);
  doc.x = LEFT;
  doc.font('Times-Bold').fontSize(12);
  doc.text(`${nomeEmp} ${tipoJur}`.toUpperCase(), { width: CW, align: 'center' });
  // linha abaixo do segundo título
  const lineY = doc.y + 2;
  doc.save();
  doc.strokeColor('#000000').lineWidth(0.5);
  doc.moveTo(LEFT, lineY).lineTo(RIGHT, lineY).stroke();
  doc.restore();
  doc.moveDown(0.6);
}

function drawQuotaTable(doc, socios, capitalTotal, topMargin) {
  const totalQ = socios.reduce((acc, s) => acc + (parseInt(onlyDigits(s.quotas || '0'), 10) || 0), 0);
  const rows = socios.map(s => {
    const q = parseInt(onlyDigits(s.quotas || '0'), 10) || 0;
    const pct = totalQ ? Math.round((q / totalQ) * 100) : 0;
    return [s.nome || '—', fmtNum(q), `${fmtNum(q)},00`, `${pct}%`];
  });
  rows.push(['TOTAL', fmtNum(totalQ), `${fmtNum(totalQ)},00`, '100%']);

  const header = ['SÓCIO', 'QUOTAS', 'VALOR R$', '%'];
  const colW = [CW * 0.44, CW * 0.18, CW * 0.24, CW * 0.14];
  const rowH = 20;
  const tableHeight = rowH * (rows.length + 1);

  ensureSpace(doc, tableHeight + 10, topMargin);

  let y = doc.y;
  const drawRow = (cells, isHeader, isBold) => {
    let x = LEFT;
    // fundo
    if (isHeader) {
      doc.save().rect(LEFT, y, CW, rowH).fill(HDR_BG).restore();
    } else if (isBold) {
      doc.save().rect(LEFT, y, CW, rowH).fill('#F0F0F0').restore();
    }
    // bordas das células + texto
    doc.font(isHeader || isBold ? 'Times-Bold' : 'Times-Roman').fontSize(9).fillColor('#000000');
    cells.forEach((c, i) => {
      doc.rect(x, y, colW[i], rowH).stroke('#000000');
      doc.text(c, x, y + 6, { width: colW[i], align: 'center' });
      x += colW[i];
    });
    y += rowH;
  };

  drawRow(header, true, false);
  rows.forEach((r, i) => drawRow(r, false, i === rows.length - 1));

  doc.y = y + 6;
}

function drawSignBlock(doc, socios, adv, topMargin) {
  // Calcula quantos "_" cabem exatamente na largura útil (CW), evitando uma "palavra"
  // sem espaços mais larga que a página — isso confundia o quebra-linha do pdfkit e
  // disparava páginas extras indevidas.
  doc.font('Times-Roman').fontSize(10);
  const underscoreW = doc.widthOfString('_');
  const lineChars = Math.max(20, Math.floor(CW / underscoreW) - 1);
  const signatureLine = '_'.repeat(lineChars);

  const blockLines = [];
  socios.forEach(s => {
    blockLines.push({ text: signatureLine, bold: false, gapBefore: 14 });
    blockLines.push({ text: (s.nome || '').toUpperCase(), bold: true, gapBefore: 2 });
    blockLines.push({ text: s.papel || 'Sócio(a)', bold: false, gapBefore: 1 });
    blockLines.push({ text: `CPF nº ${s.cpf || '—'}`, bold: false, gapBefore: 1 });
  });
  if (adv) {
    blockLines.push({ text: signatureLine, bold: false, gapBefore: 14 });
    blockLines.push({ text: (adv.nome || '').toUpperCase(), bold: true, gapBefore: 2 });
    blockLines.push({ text: `OAB/${adv.uf || 'RJ'} nº ${adv.oab || ''}`, bold: false, gapBefore: 1 });
    blockLines.push({ text: 'Advogado(a) Responsável', bold: false, gapBefore: 1 });
  }

  // Altura estimada do bloco inteiro (cada linha ~12pt + espaçamento antes)
  const estHeight = blockLines.reduce((acc, l) => acc + l.gapBefore + 12, 0);
  ensureSpace(doc, estHeight);

  blockLines.forEach(l => {
    doc.moveDown(l.gapBefore / 12);
    doc.x = LEFT;
    doc.font(l.bold ? 'Times-Bold' : 'Times-Roman').fontSize(10);
    doc.text(l.text, { width: CW, align: 'center', lineBreak: false });
  });
}

// ════════════════════════════════════════════════════════════
// Geração principal do Contrato Social
// ════════════════════════════════════════════════════════════
function gerarContratoSocial(proc, logoBuffer, comTimbrado) {
  return new Promise((resolve, reject) => {
    try {
      const socios = (proc.socios_dados && proc.socios_dados.length) ? proc.socios_dados : [{}];
      const nomeEmp = proc.nome || '';
      const tipoJur = proc.tipoJuridico || 'LTDA';
      const capital = proc.capital || '';
      const capitalN = parseInt(onlyDigits(capital) || '0', 10);
      const cnaes = proc.cnaes || [];
      const objeto = cnaes.length
        ? cnaes.map(c => {
            const d = c.desc || '';
            return d.charAt(0).toUpperCase() + d.slice(1);
          }).join('; ')
        : (proc.objeto || '');
      const foro = proc.foro || 'Niterói/RJ';
      const cidade = proc.cidade || 'Niterói';
      const uf = proc.uf || 'RJ';
      let dataDoc = proc.dataContrato || '';
      const adv = proc.advogado;
      const sp = sufPlural(socios);
      const sede = proc.enderecoSede || {};

      if (!dataDoc) {
        const hoje = new Date();
        const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
          'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
        dataDoc = `${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`;
      }

      const quals = socios.map(qualificacao);
      const preambuloTxt = quals.join(', e ') +
        ` ${sp.resolver} ${sp.constituir}, como de fato ${sp.constituido} têm, ` +
        'uma sociedade empresária limitada, que será regida pela Lei nº 10.406/02, ' +
        'combinado com o Decreto-Lei nº 9.295/46, bem como, pelas seguintes cláusulas e condições:';

      const topMargin = comTimbrado ? (HEADER_H + 2 * MM) : (2 * CM);

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: topMargin, bottom: BODY_BOTTOM, left: LEFT, right: MR },
        bufferPages: true,
      });

      const chunks = [];
      doc.on('data', d => chunks.push(d));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // doc.y já inicia em margins.top automaticamente — não precisamos resetar manualmente.

      // Título
      drawTitleBlock(doc, 'CONTRATO SOCIAL', nomeEmp, tipoJur, topMargin);

      // Preâmbulo
      writeBodyParagraph(doc, preambuloTxt, topMargin);

      // Denominação, sede, objeto e duração
      writeSectionTitle(doc, 'DENOMINAÇÃO, SEDE, OBJETO E DURAÇÃO', topMargin);
      writeBoldLeadParagraph(doc, 'CLÁUSULA PRIMEIRA –',
        `A sociedade girará sob a denominação ${nomeEmp} ${tipoJur}.`, topMargin);

      let enderecoTxt = `${sede.logradouro || ''}`;
      if (sede.numero) enderecoTxt += `, nº ${sede.numero}`;
      if (sede.complemento) enderecoTxt += `, ${sede.complemento}`;
      if (sede.bairro) enderecoTxt += `, ${sede.bairro}`;
      if (sede.cidade) enderecoTxt += `, ${sede.cidade}/${sede.uf || ''}`;
      else enderecoTxt = proc.endereco || 'endereço não informado';
      if (sede.cep) enderecoTxt += `, CEP ${sede.cep}`;

      writeBoldLeadParagraph(doc, 'CLÁUSULA SEGUNDA –',
        `A sociedade tem sua sede na ${enderecoTxt}, podendo abrir ou encerrar filiais em ` +
        `qualquer parte do território nacional por deliberação ${sp.dos_socios}.`, topMargin);

      writeBoldLeadParagraph(doc, 'CLÁUSULA TERCEIRA –',
        `A sociedade tem por objeto as seguintes atividades: ${objeto}.`, topMargin);

      writeBoldLeadParagraph(doc, 'CLÁUSULA QUARTA –',
        'A sociedade iniciará suas atividades na data do arquivamento deste ato e seu prazo de duração é por tempo indeterminado.',
        topMargin);

      // Capital Social
      writeSectionTitle(doc, 'CAPITAL SOCIAL', topMargin);
      const capitalBrl = capitalN.toLocaleString('pt-BR');
      writeBoldLeadParagraph(doc, 'CLÁUSULA QUINTA –',
        `O capital social é de R$ ${capitalBrl},00 (${valorExtenso(capitalN)}), ` +
        `dividido em ${fmtNum(capitalN)} (${ext(capitalN)}) quotas no valor nominal de ` +
        `R$ 1,00 (um real) cada, distribuídas e integralizadas em moeda corrente deste ` +
        `país, assim subscritas:`, topMargin);

      drawQuotaTable(doc, socios, capitalN, topMargin);

      writeBoldLeadParagraph(doc, 'PARÁGRAFO PRIMEIRO –',
        'As quotas são indivisíveis e não poderão ser cedidas ou transferidas a terceiros ' +
        `sem o consentimento ${sp.dos_socios}, a quem fica assegurado, em igualdade de ` +
        'condições e preço, direito de preferência para a sua aquisição se postas à venda, ' +
        'formalizando-se, se realizada a cessão delas, a alteração contratual pertinente ' +
        '(art. 1.056, art. 1.057, CC/2002).', topMargin);

      writeBoldLeadParagraph(doc, 'PARÁGRAFO SEGUNDO –',
        'A responsabilidade de cada sócio é restrita ao valor de suas quotas, mas todos ' +
        'respondem solidariamente pela integralização do capital social, conforme art. 1.052, CC/2002.',
        topMargin);

      // Administração
      writeSectionTitle(doc, 'ADMINISTRAÇÃO', topMargin);
      writeBoldLeadParagraph(doc, 'CLÁUSULA SEXTA –',
        `A sociedade será administrada ${admTexto(socios)}, que exercerá a função de ` +
        'administrador, com poderes de gestão, representação ativa e passiva da ' +
        'sociedade, podendo praticar todos os atos necessários ao funcionamento regular ' +
        'da empresa, inclusive abrir e encerrar contas bancárias, emitir cheques, ' +
        'assinar contratos e demais documentos, não necessitando de outorga especial ' +
        'para os atos de administração ordinária.', topMargin);

      writeBoldLeadParagraph(doc, 'CLÁUSULA SÉTIMA –',
        'O administrador fará jus a uma retirada mensal a título de pró-labore, cujo valor ' +
        'será fixado em assembleia e estará sujeito às contribuições previdenciárias na forma ' +
        'da legislação vigente.', topMargin);

      // Exercício social
      writeSectionTitle(doc, 'EXERCÍCIO SOCIAL', topMargin);
      writeBoldLeadParagraph(doc, 'CLÁUSULA OITAVA –',
        'O exercício social terá início em 1° de janeiro e encerrará em 31 de dezembro ' +
        'de cada ano, quando serão levantados o balanço patrimonial e demais ' +
        'demonstrações financeiras exigidas por lei.', topMargin);

      // Distribuição de lucros
      writeSectionTitle(doc, 'DISTRIBUIÇÃO DE LUCROS', topMargin);
      writeBoldLeadParagraph(doc, 'CLÁUSULA NONA –',
        'Os lucros e prejuízos apurados ao final de cada exercício social serão ' +
        `distribuídos proporcionalmente às quotas de participação de cada sócio ou ` +
        `destinados à formação de reservas, conforme deliberação ${sp.dos_socios}.`, topMargin);

      // Dissolução e liquidação
      writeSectionTitle(doc, 'DA DISSOLUÇÃO E LIQUIDAÇÃO', topMargin);
      writeBoldLeadParagraph(doc, 'CLÁUSULA DÉCIMA –',
        `A sociedade poderá ser dissolvida por deliberação ${sp.dos_socios} ou pelas ` +
        'demais causas previstas em lei. Em caso de dissolução, a liquidação observará ' +
        'o disposto nos arts. 1.102 a 1.112 do Código Civil.', topMargin);

      // Enquadramento
      writeSectionTitle(doc, 'DO ENQUADRAMENTO (ME OU EPP)', topMargin);
      writeBoldLeadParagraph(doc, 'CLÁUSULA DÉCIMA PRIMEIRA –',
        `O sócio ${sp.declaram} que a sociedade preenche os requisitos estabelecidos ` +
        'pelo art. 3º, I, da Lei Complementar nº 123, de 14 de dezembro de 2006, ' +
        'enquadrando-se como Microempresa, e que não figura em qualquer das hipóteses ' +
        'de exclusão relacionadas no § 4º do art. 3º da mencionada lei.', topMargin);

      // Disposições gerais
      writeSectionTitle(doc, 'DAS DISPOSIÇÕES GERAIS', topMargin);
      writeBoldLeadParagraph(doc, 'CLÁUSULA DÉCIMA SEGUNDA –',
        `O sócio ${sp.declaram}, sob as penas da lei, que não estão impedidos de ` +
        'exercer atividade mercantil ou de administrar sociedade empresária, e que não ' +
        'foram condenados a penas que vedem, ainda que temporariamente, o acesso a ' +
        'cargos públicos ou a exercício de atividade empresarial.', topMargin);

      // Foro
      writeSectionTitle(doc, 'DO FORO', topMargin);
      writeBoldLeadParagraph(doc, 'CLÁUSULA DÉCIMA TERCEIRA –',
        'Para dirimir quaisquer dúvidas ou controvérsias oriundas do presente contrato, ' +
        `as partes elegem o foro da Comarca de ${foro}, com renúncia expressa a qualquer ` +
        'outro, por mais privilegiado que seja.', topMargin);

      // Data e assinaturas
      ensureSpace(doc, 40);
      doc.moveDown(2);
      doc.x = LEFT;
      doc.font('Times-Roman').fontSize(10);
      doc.text(`${cidade}/${uf}, ${dataDoc}.`, { width: CW, align: 'center' });
      doc.moveDown(3);

      drawSignBlock(doc, socios, adv, topMargin);

      // Aplica cabeçalho/rodapé em todas as páginas (depois do conteúdo, via bufferPages)
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        drawChrome(doc, logoBuffer, comTimbrado);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ════════════════════════════════════════════════════════════
// Handler Netlify
// ════════════════════════════════════════════════════════════
exports.handler = async function (event) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const proc = body.proc || {};
    const comTimbrado = body.comTimbrado !== undefined ? body.comTimbrado : true;
    const logoB64 = body.logoB64 || '';

    const logoBuffer = logoB64 ? Buffer.from(logoB64, 'base64') : null;

    const pdfBuffer = await gerarContratoSocial(proc, logoBuffer, comTimbrado);
    const pdfB64 = pdfBuffer.toString('base64');

    const nomeArq = (proc.nome || 'Empresa').replace(/\s+/g, '_');

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Contrato_${nomeArq}.pdf"`,
      },
      body: pdfB64,
      isBase64Encoded: true,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
