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
// Formata um endereço a partir do objeto estruturado (logr, num, compl, bairro,
// cidade, uf, cep), no mesmo padrão usado no index.html (_legEnderecoToString):
// "Rua Esperanto, nº 44 - Ponte Preta - Itaguaí/RJ - CEP 23.812-725".
function fmtEnderecoEstruturado(end) {
  if (!end || typeof end !== 'object') return '';
  const parts = [];
  if (end.logr) parts.push(end.logr + (end.num ? ', ' + end.num : ''));
  if (end.compl) parts.push(end.compl);
  if (end.bairro) parts.push(end.bairro);
  if (end.cidade) parts.push(end.cidade + (end.uf ? '/' + end.uf : ''));
  if (end.cep) parts.push('CEP ' + end.cep);
  return parts.join(' - ');
}

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
  // Usa s.end (string já formatada) quando disponível; se vier vazio, recalcula a
  // partir de s.endereco (objeto estruturado) como rede de segurança — evita que um
  // dado inconsistente produza "residente e domiciliado(a) na ," sem endereço nenhum.
  const end = s.end || fmtEnderecoEstruturado(s.endereco) || 'endereço não informado';
  const fem = (s.genero || 'M') === 'F';
  const suf = fem ? 'a' : 'o';
  const portadorSuf = fem ? 'a' : '';
  return `${nome}, ${nac}, ${ec}, nascid${suf} em ${nasc}, natural de ${nat}, ` +
    `${prof}, portador${portadorSuf} do CPF nº ${cpf} e RG nº ${rg}, ` +
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

// Gera ordinais por extenso em caixa alta: 1→PRIMEIRA, 2→SEGUNDA, ... até a 49ª
// (suficiente para qualquer contrato social ou alteração contratual real).
function ordinalFeminino(n) {
  const unidades = ['', 'PRIMEIRA', 'SEGUNDA', 'TERCEIRA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÉTIMA', 'OITAVA', 'NONA'];
  const dezenas = ['', 'DÉCIMA', 'VIGÉSIMA', 'TRIGÉSIMA', 'QUADRAGÉSIMA'];
  if (n <= 9) return unidades[n];
  const d = Math.floor(n / 10), u = n % 10;
  if (u === 0) return dezenas[d];
  return dezenas[d] + ' ' + unidades[u];
}

// Contador de cláusulas — chamar clausula.reset() no início de cada documento,
// depois clausula.next() retorna "CLÁUSULA PRIMEIRA", "CLÁUSULA SEGUNDA", etc.
// Equivalente ao _docClausula usado no gerador de Word (index.html), para manter
// os dois formatos de saída consistentes entre si.
const clausula = {
  _n: 0,
  reset() { this._n = 0; return this; },
  next() { this._n++; return `CLÁUSULA ${ordinalFeminino(this._n)}`; },
};

// Extrai o ordinal por extenso a partir do texto livre digitado no campo "Número
// da Alteração" (ex: "1ª Alteração Contratual" -> "PRIMEIRA"). Se não conseguir
// identificar um número, tenta achar um ordinal já escrito por extenso no texto;
// como último recurso, devolve o próprio texto em caixa alta.
function ordinalDaAlteracao(numAlt) {
  const texto = String(numAlt || '').trim();
  const m = texto.match(/(\d+)\s*[ªº.]?/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 49) return ordinalFeminino(n);
  }
  const conhecidos = ['PRIMEIRA', 'SEGUNDA', 'TERCEIRA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÉTIMA', 'OITAVA', 'NONA', 'DÉCIMA'];
  const upper = texto.toUpperCase();
  const achou = conhecidos.find(o => upper.includes(o));
  return achou || upper || 'ALTERAÇÃO CONTRATUAL';
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
  }
  // Sem timbrado: nenhum rodapé é desenhado (nem linha, nem texto "Elaborado por").
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
  if (tipoLabel) {
    doc.x = LEFT;
    doc.font('Times-Bold').fontSize(13);
    doc.text(tipoLabel.toUpperCase(), { width: CW, align: 'center' });
    doc.moveDown(0.2);
  }
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

function drawSignBlock(doc, socios, adv, topMargin, dataLocalTexto) {
  // Calcula quantos "_" cabem exatamente na largura útil (CW), evitando uma "palavra"
  // sem espaços mais larga que a página — isso confundia o quebra-linha do pdfkit e
  // disparava páginas extras indevidas.
  doc.font('Times-Roman').fontSize(10);
  const underscoreW = doc.widthOfString('_');
  const lineChars = Math.max(20, Math.floor(CW / underscoreW) - 1);
  const signatureLine = '_'.repeat(lineChars);

  const blockLines = [];
  // dataLocalTexto (ex: "Niterói/RJ, 28 de junho de 2026.") é desenhado como parte do
  // MESMO bloco que as assinaturas, com a mesma verificação de espaço combinada —
  // assim a data nunca fica isolada no fim de uma página enquanto as assinaturas vão
  // para a próxima.
  if (dataLocalTexto) {
    blockLines.push({ text: dataLocalTexto, bold: false, gapBefore: 24 });
  }
  socios.forEach((s, i) => {
    const ehPrimeiraAssinatura = i === 0;
    const gapAntesDaLinha = ehPrimeiraAssinatura ? (dataLocalTexto ? 36 : 14) : 36;
    blockLines.push({ text: signatureLine, bold: false, gapBefore: gapAntesDaLinha });
    blockLines.push({ text: (s.nome || '').toUpperCase(), bold: true, gapBefore: 2 });
    blockLines.push({ text: s.papel || 'Sócio(a)', bold: false, gapBefore: 1 });
    blockLines.push({ text: `CPF nº ${s.cpf || '—'}`, bold: false, gapBefore: 1 });
  });
  if (adv) {
    blockLines.push({ text: signatureLine, bold: false, gapBefore: 36 });
    blockLines.push({ text: (adv.nome || '').toUpperCase(), bold: true, gapBefore: 2 });
    const oabTexto = String(adv.oab || '').trim();
    const oabFormatada = /^OAB/i.test(oabTexto) ? oabTexto : `OAB/${adv.uf || 'RJ'} nº ${oabTexto}`;
    blockLines.push({ text: oabFormatada, bold: false, gapBefore: 1 });
    blockLines.push({ text: 'Advogado(a) Responsável', bold: false, gapBefore: 1 });
  }

  // Altura estimada do bloco inteiro (data + todas as assinaturas), garantida de uma
  // só vez — é isso que impede a data de ficar separada das assinaturas.
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
// Escreve o "corpo" do Contrato Social (título + preâmbulo + todas as cláusulas
// padrão + tabela de quotas + assinaturas) diretamente no documento pdfkit já
// aberto. Reaproveitado tanto por gerarContratoSocial (Abertura) quanto pela
// seção de Contrato Consolidado dentro de gerarAlteracaoContratual. Não chama
// clausula.reset() — quem chama decide quando resetar a numeração (a Alteração
// usa cláusulas próprias antes da Consolidação).
function escreverCorpoContratoSocial(doc, proc, topMargin, opts = {}) {
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

  const tituloPrincipal = opts.tituloPrincipal || 'CONTRATO SOCIAL';
  const omitirAssinaturas = !!opts.omitirAssinaturas;

  // Espaço extra antes do título, usado para separar visualmente a Consolidação da
  // última cláusula da Alteração Contratual que vem imediatamente antes dela.
  if (opts.espacoAntesTitulo) {
    ensureSpace(doc, 50);
    doc.moveDown(opts.espacoAntesTitulo);
  }

  // Título
  drawTitleBlock(doc, tituloPrincipal, nomeEmp, tipoJur, topMargin);

  // NIRE/CNPJ abaixo do título (ex: na Consolidação dentro da Alteração Contratual,
  // para não depender de o leitor lembrar esses dados do início do documento).
  if (opts.nire !== undefined || opts.cnpj !== undefined) {
    doc.x = LEFT;
    doc.font('Times-Roman').fontSize(10);
    doc.text(`NIRE: ${opts.nire || 'não informado'} | CNPJ: ${opts.cnpj || 'não informado'}`, { width: CW, align: 'center' });
    doc.moveDown(0.5);
  }

  // Espaço extra entre o título/NIRE-CNPJ e o preâmbulo abaixo.
  if (opts.espacoAposTitulo) {
    doc.moveDown(opts.espacoAposTitulo);
  }

  // Preâmbulo
  writeBodyParagraph(doc, preambuloTxt, topMargin);

  // Denominação, sede, objeto e duração
  writeSectionTitle(doc, 'DENOMINAÇÃO, SEDE, OBJETO E DURAÇÃO', topMargin);
  writeBoldLeadParagraph(doc, clausula.next() + ' –',
    `A sociedade girará sob a denominação ${nomeEmp} ${tipoJur}.`, topMargin);

  // Monta o endereço da sede a partir do objeto estruturado (sede), garantindo que o
  // CEP nunca se perca mesmo quando algum campo individual (ex: cidade) está vazio.
  // Só cai no fallback de string simples (proc.endereco) quando o objeto sede não tem
  // nenhum dado utilizável.
  const sedeTemDados = sede.logradouro || sede.bairro || sede.cidade || sede.cep;
  let enderecoTxt;
  if (sedeTemDados) {
    const partes = [];
    if (sede.logradouro) partes.push(sede.logradouro + (sede.numero ? `, nº ${sede.numero}` : ''));
    if (sede.complemento) partes.push(sede.complemento);
    if (sede.bairro) partes.push(sede.bairro);
    if (sede.cidade) partes.push(`${sede.cidade}/${sede.uf || ''}`);
    enderecoTxt = partes.join(', ');
    if (sede.cep) enderecoTxt += `, CEP ${sede.cep}`;
  } else {
    enderecoTxt = proc.endereco || 'endereço não informado';
  }

  writeBoldLeadParagraph(doc, clausula.next() + ' –',
    `A sociedade tem sua sede na ${enderecoTxt}, podendo abrir ou encerrar filiais em ` +
    `qualquer parte do território nacional por deliberação ${sp.dos_socios}.`, topMargin);

  writeBoldLeadParagraph(doc, clausula.next() + ' –',
    `A sociedade tem por objeto as seguintes atividades: ${objeto}.`, topMargin);

  writeBoldLeadParagraph(doc, clausula.next() + ' –',
    'A sociedade iniciará suas atividades na data do arquivamento deste ato e seu prazo de duração é por tempo indeterminado.',
    topMargin);

  // Capital Social
  writeSectionTitle(doc, 'CAPITAL SOCIAL', topMargin);
  const capitalBrl = capitalN.toLocaleString('pt-BR');
  writeBoldLeadParagraph(doc, clausula.next() + ' –',
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
  writeBoldLeadParagraph(doc, clausula.next() + ' –',
    `A sociedade será administrada ${admTexto(socios)}, que exercerá a função de ` +
    'administrador, com poderes de gestão, representação ativa e passiva da ' +
    'sociedade, podendo praticar todos os atos necessários ao funcionamento regular ' +
    'da empresa, inclusive abrir e encerrar contas bancárias, emitir cheques, ' +
    'assinar contratos e demais documentos, não necessitando de outorga especial ' +
    'para os atos de administração ordinária.', topMargin);

  writeBoldLeadParagraph(doc, clausula.next() + ' –',
    'O administrador fará jus a uma retirada mensal a título de pró-labore, cujo valor ' +
    'será fixado em assembleia e estará sujeito às contribuições previdenciárias na forma ' +
    'da legislação vigente.', topMargin);

  // Exercício social
  writeSectionTitle(doc, 'EXERCÍCIO SOCIAL', topMargin);
  writeBoldLeadParagraph(doc, clausula.next() + ' –',
    'O exercício social terá início em 1° de janeiro e encerrará em 31 de dezembro ' +
    'de cada ano, quando serão levantados o balanço patrimonial e demais ' +
    'demonstrações financeiras exigidas por lei.', topMargin);

  // Distribuição de lucros
  writeSectionTitle(doc, 'DISTRIBUIÇÃO DE LUCROS', topMargin);
  writeBoldLeadParagraph(doc, clausula.next() + ' –',
    'Os lucros e prejuízos apurados ao final de cada exercício social serão ' +
    `distribuídos proporcionalmente às quotas de participação de cada sócio ou ` +
    `destinados à formação de reservas, conforme deliberação ${sp.dos_socios}.`, topMargin);

  // Dissolução e liquidação
  writeSectionTitle(doc, 'DA DISSOLUÇÃO E LIQUIDAÇÃO', topMargin);
  writeBoldLeadParagraph(doc, clausula.next() + ' –',
    `A sociedade poderá ser dissolvida por deliberação ${sp.dos_socios} ou pelas ` +
    'demais causas previstas em lei. Em caso de dissolução, a liquidação observará ' +
    'o disposto nos arts. 1.102 a 1.112 do Código Civil.', topMargin);

  // Enquadramento
  writeSectionTitle(doc, 'DO ENQUADRAMENTO (ME OU EPP)', topMargin);
  writeBoldLeadParagraph(doc, clausula.next() + ' –',
    `O sócio ${sp.declaram} que a sociedade preenche os requisitos estabelecidos ` +
    'pelo art. 3º, I, da Lei Complementar nº 123, de 14 de dezembro de 2006, ' +
    'enquadrando-se como Microempresa, e que não figura em qualquer das hipóteses ' +
    'de exclusão relacionadas no § 4º do art. 3º da mencionada lei.', topMargin);

  // Disposições gerais
  writeSectionTitle(doc, 'DAS DISPOSIÇÕES GERAIS', topMargin);
  writeBoldLeadParagraph(doc, clausula.next() + ' –',
    `O sócio ${sp.declaram}, sob as penas da lei, que não estão impedidos de ` +
    'exercer atividade mercantil ou de administrar sociedade empresária, e que não ' +
    'foram condenados a penas que vedem, ainda que temporariamente, o acesso a ' +
    'cargos públicos ou a exercício de atividade empresarial.', topMargin);

  // Foro
  writeSectionTitle(doc, 'DO FORO', topMargin);
  writeBoldLeadParagraph(doc, clausula.next() + ' –',
    'Para dirimir quaisquer dúvidas ou controvérsias oriundas do presente contrato, ' +
    `as partes elegem o foro da Comarca de ${foro}, com renúncia expressa a qualquer ` +
    'outro, por mais privilegiado que seja.', topMargin);

  // Data + assinaturas: escritas como um único bloco (ver drawSignBlock), garantindo
  // que a data nunca fique isolada no fim de uma página enquanto as assinaturas vão
  // para a próxima.
  const dataLocalTexto = `${cidade}/${uf}, ${dataDoc}.`;

  if (!omitirAssinaturas) {
    drawSignBlock(doc, socios, adv, topMargin, dataLocalTexto);
  }
  // Quando omitirAssinaturas é true (caso da Consolidação dentro da Alteração
  // Contratual), a assinatura real vem só uma vez no fim do documento todo — não
  // escrevemos a data aqui; quem chama esta função é responsável por desenhar a
  // data junto com o bloco de assinatura final (ver gerarAlteracaoContratual).
}

function gerarContratoSocial(proc, logoBuffer, comTimbrado) {
  return new Promise((resolve, reject) => {
    try {
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

      clausula.reset();
      escreverCorpoContratoSocial(doc, proc, topMargin);

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
// Helpers específicos da Alteração Contratual
// ════════════════════════════════════════════════════════════

// Formata um valor monetário em string (ex: "50000" ou "50.000,00") para "R$ X.XXX,XX".
// Aceita tanto formato bruto (somente dígitos) quanto já formatado em pt-BR.
// Valor por extenso com centavos (ex: "cinquenta mil reais", "cinquenta mil reais e
// vinte centavos"), aceitando tanto número cru ("50000") quanto formatado em pt-BR
// ("50.000,00"). Usa a função ext() já existente para a parte inteira.
function valorExtensoComCentavos(v) {
  if (!v) return 'valor não informado';
  const s = String(v).trim();
  let n;
  if (/^\d+$/.test(s)) {
    n = parseInt(s, 10);
  } else {
    n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  }
  if (isNaN(n)) return String(v);
  const inteiro = Math.trunc(n);
  const centavos = Math.round((n - inteiro) * 100);
  const moeda = inteiro === 1 ? 'real' : 'reais';
  let texto = ext(inteiro) + ' ' + moeda;
  if (centavos > 0) {
    texto += ' e ' + ext(centavos) + ' ' + (centavos === 1 ? 'centavo' : 'centavos');
  }
  return texto;
}

function fmtCapitalBRL(v) {
  if (!v) return 'R$ ___________';
  const s = String(v).trim();
  let n;
  if (/^\d+$/.test(s)) {
    // só dígitos: trata como reais inteiros (mesma convenção do restante do código)
    n = parseInt(s, 10);
  } else {
    // formato pt-BR "50.000,00" -> remove separador de milhar, troca vírgula por ponto
    n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  }
  if (isNaN(n)) return s;
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Data por extenso em português (ex: "28 de junho de 2026"), a partir de uma data ISO
// (YYYY-MM-DD) ou, se vazia, a data atual.
function fmtDataExtenso(iso) {
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  let d;
  if (iso) {
    d = new Date(iso + 'T12:00:00');
    if (isNaN(d.getTime())) d = new Date();
  } else {
    d = new Date();
  }
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

// Data curta em pt-BR (DD/MM/AAAA), usada na qualificação dos sócios.
function fmtDataCurta(iso) {
  if (!iso) return '___/___/______';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR');
}

// Estado civil flexionado por gênero, incluindo regime de casamento quando aplicável.
// Espelha a lógica de _docEstadoCivilComRegime do index.html.
function estadoCivilComRegime(s) {
  const fem = (s.genero || 'M') === 'F';
  const map = {
    'Solteiro(a)': fem ? 'solteira' : 'solteiro',
    'Casado(a)': fem ? 'casada' : 'casado',
    'Divorciado(a)': fem ? 'divorciada' : 'divorciado',
    'Viúvo(a)': fem ? 'viúva' : 'viúvo',
    'União Estável': 'em união estável',
  };
  let base = map[s.ecivil];
  if (base === undefined) {
    base = (s.ecivil || '').replace(/\(a\)/gi, fem ? 'a' : '').toLowerCase();
  }
  if (s.ecivil === 'Casado(a)' && s.regimecas) {
    return `${base} sob o regime de ${String(s.regimecas).toLowerCase()}`;
  }
  return base;
}

// Monta as cláusulas de alteração ativas, na mesma ordem e com o mesmo texto-base
// usado na versão DOCX (_buildAlteracaoContratual no index.html), para que o PDF
// gerado pelo servidor e o Word gerado no navegador fiquem consistentes entre si.
// Monta o trecho do preâmbulo referente ao órgão de registro (Junta Comercial ou
// Cartório), incluindo NIRE/Matrícula e número de protocolo do último registro,
// quando esses dados tiverem sido informados. Espelha _textoOrgaoRegistro do
// index.html (versão DOCX), para que PDF e Word fiquem consistentes entre si.
function textoOrgaoRegistro(altDados, prefixo, cnpj) {
  const ad = altDados || {};
  const isCartorio = ad.regOrgao === 'cartorio';
  const orgaoNome = ad.regNome ? ad.regNome : (isCartorio ? 'Cartório competente' : 'Junta Comercial competente');
  const numLabel = isCartorio ? 'Matrícula' : 'NIRE';
  // "sob o NIRE nº X e CNPJ nº Y" quando ambos disponíveis (padrão do modelo de
  // referência); cai para variações mais simples conforme o que estiver faltando.
  let numTexto = '';
  if (ad.regNumero && cnpj) {
    numTexto = `, sob o ${numLabel} nº ${ad.regNumero} e CNPJ nº ${cnpj}`;
  } else if (ad.regNumero) {
    numTexto = `, sob ${numLabel} nº ${ad.regNumero}`;
  } else if (cnpj) {
    numTexto = `, sob CNPJ nº ${cnpj}`;
  }
  const protocoloTexto = ad.regProtocolo ? `, conforme protocolo de registro nº ${ad.regProtocolo}` : '';
  const pfx = prefixo !== undefined ? prefixo : 'arquivada na';
  if (!ad.regNome && !ad.regNumero && !ad.regProtocolo) {
    return `${pfx ? pfx + ' ' : ''}Junta Comercial/Cartório competente`;
  }
  return `${pfx ? pfx + ' ' : ''}${orgaoNome}${numTexto}${protocoloTexto}`;
}

// Normaliza os dados de uma pessoa antes de chamar qualificacao(): converte data de
// nascimento de ISO (YYYY-MM-DD) para o formato curto pt-BR, e flexiona o estado civil
// por gênero (ex: "Solteiro(a)" + feminino -> "solteira"), usando estadoCivilComRegime.
// Usado na Alteração Contratual e na seção de Contrato Consolidado, onde os dados de
// pessoas novas (cessionário, novo sócio) chegam em formato bruto do formulário.
function normalizarPessoaParaQualificacao(p) {
  if (!p) return p;
  const norm = { ...p };
  if (norm.nasc && /^\d{4}-\d{2}-\d{2}/.test(norm.nasc)) {
    norm.nasc = fmtDataCurta(norm.nasc);
  }
  const fem = (norm.genero || 'M') === 'F';
  norm.nac = norm.nac || (fem ? 'brasileira' : 'brasileiro');
  if (norm.ecivil) {
    norm.ecivil = estadoCivilComRegime(norm);
  }
  return norm;
}

function qualificacaoPessoaAlteracao(p) {
  if (!p) return 'pessoa não informada';
  return qualificacao(normalizarPessoaParaQualificacao(p));
}

// ════════════════════════════════════════════════════════════
// Snapshot pós-alteração (para a seção de Contrato Consolidado)
// ════════════════════════════════════════════════════════════
// Calcula o estado da empresa após a alteração ser aplicada — mesmos campos de um
// Contrato Social (nome, endereço, objeto, tipo jurídico, capital, quadro de sócios),
// já com os valores NOVOS, conforme os subtipos marcados em proc.subtipos e os dados
// em proc.altDados. Espelha _legCalcularSnapshotPosAlteracao do index.html, para que
// PDF e Word produzam o mesmo resultado. Não modifica proc — devolve uma cópia.
function calcularSnapshotPosAlteracao(proc) {
  const sub = proc.subtipos || {};
  const ad = proc.altDados || {};
  const snap = JSON.parse(JSON.stringify(proc));
  snap.socios_dados = (proc.socios_dados || [{}]).map(s => ({ ...s }));

  if (sub.nome && ad.nomePara) {
    snap.nome = ad.nomePara;
  }
  if (sub.tipo_juridico && ad.tjPara) {
    snap.tipoJuridico = ad.tjPara;
  }
  if (sub.endereco && ad.endPara) {
    snap.endereco = ad.endPara + (ad.endMunicipio ? `, ${ad.endMunicipio}` : '') + (ad.endUf ? `/${ad.endUf}` : '') + (ad.endCep ? `, CEP ${ad.endCep}` : '');
    snap.enderecoSede = null;
  }
  if (sub.atividades && ad.objPara) {
    snap.objeto = ad.objPara;
    snap.cnaes = [];
  }
  if (sub.capital && ad.capitalPara) {
    let capitalLimpo = String(ad.capitalPara).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '').split('.')[0];
    if (!/^\d+$/.test(capitalLimpo)) capitalLimpo = String(ad.capitalPara).replace(/\D/g, '');
    snap.capital = capitalLimpo || ad.capitalPara;

    // Quando o capital muda SEM mudança simultânea no quadro de sócios (sub.socio),
    // as quotas precisam ser recalculadas para bater com o novo capital total —
    // senão a tabela de quotas mostra o valor antigo, divergindo do texto da
    // cláusula. Caso simples e inequívoco: 1 único sócio fica com 100% do novo
    // capital. Com múltiplos sócios, mantém a proporção (%) que cada um já tinha.
    if (!sub.socio) {
      const capitalNovoNum = parseInt(snap.capital, 10) || 0;
      if (snap.socios_dados.length === 1) {
        snap.socios_dados[0].quotas = String(capitalNovoNum);
      } else if (snap.socios_dados.length > 1) {
        const totalAntigoNum = snap.socios_dados.reduce((acc, s) => acc + (parseInt(String(s.quotas || '0').replace(/\D/g, ''), 10) || 0), 0);
        if (totalAntigoNum > 0) {
          let distribuido = 0;
          snap.socios_dados.forEach((s, i) => {
            const atuais = parseInt(String(s.quotas || '0').replace(/\D/g, ''), 10) || 0;
            const novaQuota = (i === snap.socios_dados.length - 1)
              ? (capitalNovoNum - distribuido)
              : Math.round(atuais / totalAntigoNum * capitalNovoNum);
            distribuido += novaQuota;
            s.quotas = String(novaQuota);
          });
        }
      }
    }
  }

  if (sub.socio) {
    if (ad.socioTipo === 'cessao') {
      const cedentesIdx = ad.cessCedentesIdx || [];
      const quotasCedidas = parseInt(String(ad.cessQuotas || '0').replace(/\D/g, ''), 10) || 0;
      if (ad.cessSaiTotalmente) {
        snap.socios_dados = snap.socios_dados.filter((s, i) => !cedentesIdx.includes(i));
      } else {
        const reducaoPorCedente = cedentesIdx.length ? Math.floor(quotasCedidas / cedentesIdx.length) : 0;
        cedentesIdx.forEach(i => {
          if (snap.socios_dados[i]) {
            const atuais = parseInt(String(snap.socios_dados[i].quotas || '0').replace(/\D/g, ''), 10) || 0;
            snap.socios_dados[i].quotas = String(Math.max(0, atuais - reducaoPorCedente));
          }
        });
      }
      if (ad.cessCessionarioTipo === 'novo' && ad.cessCessionarioNovo) {
        snap.socios_dados.push({ ...normalizarPessoaParaQualificacao(ad.cessCessionarioNovo), quotas: String(quotasCedidas), papel: 'Sócio(a) não administrador(a)' });
      } else if (ad.cessCessionarioTipo === 'existente' && ad.cessCessionarioIdx !== '' && ad.cessCessionarioIdx != null) {
        const idx = parseInt(ad.cessCessionarioIdx, 10);
        if (snap.socios_dados[idx]) {
          const atuais = parseInt(String(snap.socios_dados[idx].quotas || '0').replace(/\D/g, ''), 10) || 0;
          snap.socios_dados[idx].quotas = String(atuais + quotasCedidas);
        }
      }
      // Caso de borda: se restar um único sócio e o capital também mudou nesta
      // alteração, esse sócio único deve ficar com 100% das quotas (= novo capital).
      if (sub.capital && snap.socios_dados.length === 1) {
        snap.socios_dados[0].quotas = snap.capital;
      }
    } else if (ad.socioTipo === 'entrada' && ad.entradaNovo) {
      const quotasNovo = parseInt(String(ad.entradaQuotas || '0').replace(/\D/g, ''), 10) || 0;
      if (!sub.capital) {
        // Capital total permanece igual: dilui proporcionalmente as quotas existentes.
        const totalAntesNum = snap.socios_dados.reduce((acc, s) => acc + (parseInt(String(s.quotas || '0').replace(/\D/g, ''), 10) || 0), 0);
        if (totalAntesNum > 0) {
          snap.socios_dados.forEach(s => {
            const atuais = parseInt(String(s.quotas || '0').replace(/\D/g, ''), 10) || 0;
            const reducao = Math.round(atuais / totalAntesNum * quotasNovo);
            s.quotas = String(Math.max(0, atuais - reducao));
          });
        }
      }
      snap.socios_dados.push({ ...normalizarPessoaParaQualificacao(ad.entradaNovo), quotas: String(quotasNovo), papel: 'Sócio(a) não administrador(a)' });
    } else if (ad.socioTipo === 'saida' && ad.saidaSocioIdx !== '' && ad.saidaSocioIdx != null) {
      const idx = parseInt(ad.saidaSocioIdx, 10);
      const saindo = snap.socios_dados[idx];
      const quotasSaida = saindo ? (parseInt(String(saindo.quotas || '0').replace(/\D/g, ''), 10) || 0) : 0;
      snap.socios_dados = snap.socios_dados.filter((s, i) => i !== idx);
      if (ad.saidaDestino === 'reduzir') {
        const capitalAtualNum = parseInt(String(proc.capital || '0').replace(/\D/g, ''), 10) || 0;
        snap.capital = String(Math.max(0, capitalAtualNum - quotasSaida));
      } else {
        // Redistribui proporcionalmente entre os remanescentes, mantendo o capital total.
        const totalRemanescentesNum = snap.socios_dados.reduce((acc, s) => acc + (parseInt(String(s.quotas || '0').replace(/\D/g, ''), 10) || 0), 0);
        if (totalRemanescentesNum > 0) {
          let distribuido = 0;
          snap.socios_dados.forEach((s, i) => {
            const atuais = parseInt(String(s.quotas || '0').replace(/\D/g, ''), 10) || 0;
            const acrescimo = (i === snap.socios_dados.length - 1)
              ? (quotasSaida - distribuido)
              : Math.round(atuais / totalRemanescentesNum * quotasSaida);
            distribuido += acrescimo;
            s.quotas = String(atuais + acrescimo);
          });
        } else if (snap.socios_dados.length === 1) {
          snap.socios_dados[0].quotas = String((parseInt(String(snap.socios_dados[0].quotas || '0').replace(/\D/g, ''), 10) || 0) + quotasSaida);
        }
      }
    }
  }

  if (sub.administrador && ad.admPara) {
    snap.socios_dados.forEach(s => {
      if (s.papel && s.papel.includes('Administrador')) s.papel = 'Sócio(a) não administrador(a)';
    });
    const novoAdmin = snap.socios_dados.find(s => (s.nome || '').toLowerCase() === String(ad.admPara).toLowerCase());
    if (novoAdmin) novoAdmin.papel = 'Administrador(a) e Sócio(a)';
  }

  // Garante que sempre exista pelo menos um administrador após as mudanças acima.
  const temAdmin = snap.socios_dados.some(s => s.papel && s.papel.includes('Administrador'));
  if (!temAdmin && snap.socios_dados.length > 0) {
    snap.socios_dados[0].papel = 'Administrador(a) e Sócio(a)';
  }

  return snap;
}

// ════════════════════════════════════════════════════════════
// Cláusulas dinâmicas de "DAS ALTERAÇÕES"
// ════════════════════════════════════════════════════════════
// Cada bloco tem seu próprio título de seção e uma ou mais cláusulas numeradas
// sequencialmente (usa clausula.next()). Espelha _montarClausulasAlteracaoDoc do
// index.html. Recebe doc para poder desenhar diretamente (título + parágrafos).
// Identifica os sócios que saem do quadro nesta alteração (cedente que se retira
// totalmente na cessão, ou sócio que sai no sub-cenário de saída) — essas pessoas
// não constam mais em snapshot.socios_dados, mas ainda precisam assinar o
// instrumento, já que estão dando quitação/cedendo suas quotas nele.
function socioSaindoParaAssinatura(proc) {
  const sub = proc.subtipos || {};
  const ad = proc.altDados || {};
  const socios = proc.socios_dados || [{}];
  const saindo = [];

  if (sub.socio) {
    if (ad.socioTipo === 'cessao' && ad.cessSaiTotalmente) {
      (ad.cessCedentesIdx || []).forEach(i => {
        if (socios[i]) saindo.push({ ...socios[i], papel: 'Sócio(a) Cedente' });
      });
    } else if (ad.socioTipo === 'saida' && ad.saidaSocioIdx !== '' && ad.saidaSocioIdx != null) {
      const idx = parseInt(ad.saidaSocioIdx, 10);
      if (socios[idx]) saindo.push({ ...socios[idx], papel: 'Sócio(a) Retirante' });
    }
  }

  return saindo;
}

function escreverClausulasAlteracao(doc, proc, topMargin, snapshot) {
  const sub = proc.subtipos || {};
  const ad = proc.altDados || {};
  const socios = proc.socios_dados || [{}];
  let algumaClausulaEscrita = false;

  const escreverBloco = (titulo, textos) => {
    writeSectionTitle(doc, titulo, topMargin);
    textos.forEach(t => writeBoldLeadParagraph(doc, clausula.next() + ' -', t, topMargin));
    algumaClausulaEscrita = true;
  };

  // Igual a escreverBloco, mas desenha a tabela de quotas atualizada (a partir do
  // snapshot pós-alteração) imediatamente após o texto da cláusula — usado nos casos
  // em que o texto termina em "...conforme nova composição do quadro societário a
  // seguir", para que essa composição realmente apareça ali, não só na Consolidação.
  const escreverBlocoComTabela = (titulo, textos) => {
    escreverBloco(titulo, textos);
    if (snapshot) {
      const capitalSnapNum = parseInt(onlyDigits(snapshot.capital || '0') || '0', 10);
      drawQuotaTable(doc, snapshot.socios_dados || [{}], capitalSnapNum, topMargin);
    }
  };

  // ── Denominação Social ──
  if (sub.nome && ad.nomePara) {
    const fantasia = ad.nomeFantasia ? ` A sociedade passa a adotar o nome fantasia ${ad.nomeFantasia}.` : '';
    escreverBloco('DA DENOMINAÇÃO', [
      `A sociedade passa a girar sob a denominação ${ad.nomePara} ${proc.tipoJuridico || 'LTDA'}.${fantasia}`,
    ]);
  }

  // ── Endereço ──
  if (sub.endereco && ad.endPara) {
    const mun = ad.endMunicipio ? `, ${ad.endMunicipio}` : '';
    const uf = ad.endUf ? `/${ad.endUf}` : '';
    const cep = ad.endCep ? `, CEP ${ad.endCep}` : '';
    escreverBloco('DO ENDEREÇO', [
      `A sociedade passa a ter sua sede na ${ad.endPara}${mun}${uf}${cep}, podendo a critério de seu(s) sócio(s) abrir ou encerrar filiais em qualquer parte do território nacional.`,
    ]);
  }

  // ── Objeto Social ──
  if (sub.atividades && ad.objPara) {
    escreverBloco('DO OBJETO SOCIAL', [
      `A sociedade passa a ter como objeto social as seguintes atividades: ${ad.objPara}.`,
    ]);
  }

  // ── Tipo Jurídico ──
  if (sub.tipo_juridico && ad.tjPara) {
    const mot = ad.tjMotivo ? ` Fundamento: ${ad.tjMotivo}.` : '';
    escreverBloco('DO TIPO JURÍDICO', [
      `A sociedade passa a adotar o tipo jurídico ${ad.tjPara}, mantendo-se inalteradas as demais características da pessoa jurídica.${mot}`,
    ]);
  }

  // ── Quadro Social (Cessão / Entrada / Saída) ──
  if (sub.socio) {
    if (ad.socioTipo === 'cessao') {
      const cedentesIdx = ad.cessCedentesIdx || [];
      const cedentes = cedentesIdx.map(i => socios[i]).filter(Boolean);
      const nomesCedentes = cedentes.map(s => (s.nome || '').toUpperCase()).join(', ');
      const quotasCedidasNum = parseInt(String(ad.cessQuotas || '0').replace(/\D/g, ''), 10) || 0;
      const valorCessao = ad.cessValor ? `R$ ${ad.cessValor}` : `R$ ${fmtNum(quotasCedidasNum)},00`;
      const isCessionarioNovo = ad.cessCessionarioTipo === 'novo' && ad.cessCessionarioNovo;
      const cessionarioNome = isCessionarioNovo
        ? (ad.cessCessionarioNovo.nome || '').toUpperCase()
        : ((socios[parseInt(ad.cessCessionarioIdx, 10)] || {}).nome || '').toUpperCase();
      const cessionarioQualificacao = isCessionarioNovo
        ? qualificacaoPessoaAlteracao(ad.cessCessionarioNovo)
        : cessionarioNome;
      const verboPlural = cedentes.length > 1;

      escreverBloco('DA CESSÃO DE QUOTAS', [
        `O(a)(s) sócio(a)(s) ${nomesCedentes || 'cedente(s)'}, já qualificado(s) no preâmbulo, ` +
        `${verboPlural ? 'VENDEM E TRANSFEREM' : 'VENDE E TRANSFERE'}, em caráter definitivo e irrevogável, ` +
        `${quotasCedidasNum ? `${fmtNum(quotasCedidasNum)} (${ext(quotasCedidasNum)}) quotas` : 'a totalidade de suas quotas'} ` +
        `do capital social da sociedade, no valor nominal de R$ 1,00 (um real) cada, pelo valor total de ${valorCessao}, ` +
        `pago e recebido neste ato, a: ${cessionarioQualificacao}; dando o(s) cedente(s) plena, geral e irrevogável quitação ` +
        `ao(à) cessionário(a), declarando que as quotas ora cedidas se encontram livres e desembaraçadas de quaisquer ônus, gravames ou restrições.`,
      ]);

      if (ad.cessSaiTotalmente) {
        escreverBloco('DA RETIRADA DO SÓCIO', [
          `Em razão da cessão acima, ${verboPlural ? 'os sócios' : 'o(a) sócio(a)'} ${nomesCedentes} RETIRA(M)-SE definitivamente do ` +
          `quadro societário da sociedade, nada mais tendo a reclamar da sociedade ou dos demais sócios a qualquer título, ` +
          `outorgando a mais plena quitação por todos os direitos decorrentes de sua(s) participação(ões) societária(s).`,
        ]);
      }

      if (!sub.capital) {
        escreverBlocoComTabela('DO CAPITAL SOCIAL', [
          `Em virtude da cessão acima formalizada, o capital social permanece inalterado, passando as quotas cedidas a ser ` +
          `tituladas por ${cessionarioNome}, conforme nova composição do quadro societário a seguir.`,
        ]);
      }
    } else if (ad.socioTipo === 'entrada' && ad.entradaNovo) {
      const quotasNovo = parseInt(String(ad.entradaQuotas || '0').replace(/\D/g, ''), 10) || 0;
      escreverBloco('DA ADMISSÃO DO SÓCIO', [
        `Ingressa na sociedade, na qualidade de sócio(a), ${qualificacaoPessoaAlteracao(ad.entradaNovo)}, subscrevendo ` +
        `${quotasNovo ? `${fmtNum(quotasNovo)} (${ext(quotasNovo)}) quotas` : 'quotas'} do capital social, no valor nominal ` +
        `de R$ 1,00 (um real) cada${ad.entradaObs ? `, ${ad.entradaObs}` : ''}.`,
      ]);
      if (!sub.capital) {
        escreverBlocoComTabela('DO CAPITAL SOCIAL', [
          'Em razão da admissão do(a) novo(a) sócio(a), as quotas dos demais sócios ficam proporcionalmente diluídas, ' +
          'permanecendo o capital social no mesmo valor total, conforme nova composição do quadro societário a seguir.',
        ]);
      }
    } else if (ad.socioTipo === 'saida' && ad.saidaSocioIdx !== '' && ad.saidaSocioIdx != null) {
      const saindo = socios[parseInt(ad.saidaSocioIdx, 10)];
      const nomeSaida = ((saindo && saindo.nome) || '').toUpperCase();
      escreverBloco('DA RETIRADA DO SÓCIO', [
        `O(A) sócio(a) ${nomeSaida}, já qualificado(a) no preâmbulo, RETIRA-SE definitivamente do quadro societário da ` +
        `sociedade, nada mais tendo a reclamar da sociedade ou dos demais sócios a qualquer título, outorgando a mais ` +
        `plena quitação por todos os direitos decorrentes de sua participação societária.`,
      ]);
      if (!sub.capital) {
        const textoDestino = ad.saidaDestino === 'reduzir'
          ? 'o capital social é reduzido proporcionalmente ao valor das quotas do(a) sócio(a) retirante'
          : 'as quotas do(a) sócio(a) retirante são redistribuídas entre os sócios remanescentes, permanecendo o capital social no mesmo valor total';
        escreverBlocoComTabela('DO CAPITAL SOCIAL', [
          `Em razão da retirada acima, ${textoDestino}, conforme nova composição do quadro societário a seguir.`,
        ]);
      }
    }
  }

  // ── Capital Social (autônomo ou combinado) ──
  if (sub.capital) {
    const capitalAtualFmt = fmtCapitalBRL(ad.capitalDe || proc.capital);
    const capitalAtualExtenso = valorExtensoComCentavos(ad.capitalDe || proc.capital);
    const capitalNovoFmt = fmtCapitalBRL(ad.capitalPara || ad.capitalDe || proc.capital);
    const capitalNovoExtenso = valorExtensoComCentavos(ad.capitalPara || ad.capitalDe || proc.capital);
    // ad.capitalObs costuma vir como uma frase livre (ex: "integralizado em moeda
    // corrente do Brasil"), sem pontuação própria — junta como continuação da mesma
    // frase, evitando o "a seguir. observação." com pontuação duplicada/estranha.
    const obsLimpa = (ad.capitalObs || '').trim().replace(/\.+$/, '');
    const obs = obsLimpa ? `, ${obsLimpa[0].toLowerCase()}${obsLimpa.slice(1)}` : '';
    escreverBlocoComTabela('DO CAPITAL SOCIAL', [
      `O capital social que é de ${capitalAtualFmt} (${capitalAtualExtenso}), passa a ser de ${capitalNovoFmt} ` +
      `(${capitalNovoExtenso})${obs}, conforme nova composição do quadro societário a seguir.`,
    ]);
  }

  // ── Administrador ──
  if (sub.administrador) {
    const admTipoMap = {
      substituicao: 'Substitui-se o(a) administrador(a) da sociedade',
      nomeacao: 'Nomeia-se novo(a) administrador(a) da sociedade',
      destituicao: 'Destitui-se o(a) administrador(a) da sociedade',
      mandato: 'Altera-se o mandato e/ou poderes do(a) administrador(a)',
    };
    const tipoTexto = admTipoMap[ad.admTipo] || 'Altera-se a administração da sociedade';
    const de = ad.admDe ? `, sendo o(a) anterior ${ad.admDe}` : '';
    const para = ad.admPara ? `, passando a ser exercida por ${ad.admPara}` : '';
    const mandato = ad.admMandato ? ` Prazo do mandato: ${ad.admMandato}.` : '';
    const poderes = ad.admPoderes ? ` Poderes: ${ad.admPoderes}.` : '';
    escreverBloco('DA ADMINISTRAÇÃO', [
      `${tipoTexto}${de}${para}, conforme deliberação unânime dos sócios.${mandato}${poderes}`,
    ]);
  }

  if (!algumaClausulaEscrita) {
    writeBoldLeadParagraph(doc, clausula.next() + ' -',
      'As cláusulas a serem alteradas serão especificadas conforme deliberação dos sócios.', topMargin);
  }

  // Última cláusula fixa: permanece em vigor o contrato consolidado
  writeBoldLeadParagraph(doc, clausula.next() + ' -',
    'Permanecem em pleno vigor todas as demais cláusulas e condições do contrato social, ' +
    'na sua última redação consolidada, que aqui não foram alteradas pelo presente instrumento.', topMargin);
}

// ════════════════════════════════════════════════════════════
// Geração principal da Alteração Contratual (+ Contrato Consolidado)
// ════════════════════════════════════════════════════════════
function gerarAlteracaoContratual(proc, logoBuffer, comTimbrado) {
  return new Promise((resolve, reject) => {
    try {
      const socios = (proc.socios_dados && proc.socios_dados.length) ? proc.socios_dados : [{}];
      const nomeEmp = proc.nome || '';
      const tipoJur = proc.tipoJuridico || 'LTDA';
      const numAlt = proc.numeroAlteracao || '1ª Alteração Contratual';
      const nire = proc.nire || '';
      const cnpj = proc.cnpj || '00.000.000/0001-00';

      const registroOrgaoSemPrefixo = textoOrgaoRegistro(proc.altDados, '', cnpj);
      const ordinalAlteracao = ordinalDaAlteracao(numAlt);
      const sp = sufPlural(socios);

      const snapshot = calcularSnapshotPosAlteracao(proc);

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

      clausula.reset();

      // Título
      drawTitleBlock(doc, numAlt, nomeEmp, tipoJur, topMargin);
      doc.x = LEFT;
      doc.font('Times-Roman').fontSize(10);
      doc.text(`NIRE: ${nire || 'não informado'} | CNPJ: ${cnpj}`, { width: CW, align: 'center' });
      doc.moveDown(1);

      // Preâmbulo: qualificação dos sócios atuais
      const quals = socios.map(qualificacao);
      const preambuloQuals = quals.join(', e ');
      writeBodyParagraph(doc, preambuloQuals + ',', topMargin);

      const unicoOuComponentes = socios.length > 1 ? 'sócios componentes da firma' : 'único(a) sócio(a) componente da firma';
      // Endereço da sede ANTES desta alteração (mesmo que o subtipo Endereço não
      // esteja marcado nesta alteração específica) — sempre aparece no preâmbulo.
      const enderecoSedeAtual = proc.endereco || fmtEnderecoEstruturado(proc.enderecoSede) || 'endereço não informado';
      writeBodyParagraph(doc,
        `${unicoOuComponentes} ${nomeEmp} ${tipoJur}, com sede em ${enderecoSedeAtual}, devidamente registrada na ${registroOrgaoSemPrefixo}, ` +
        `${sp.resolver}, na melhor forma de direito, promover a presente alteração contratual, a ${ordinalAlteracao}, ` +
        'mediante as seguintes cláusulas e condições:', topMargin);

      // Cláusulas dinâmicas de alteração
      escreverClausulasAlteracao(doc, proc, topMargin, snapshot);

      // ── CONTRATO CONSOLIDADO ──
      escreverCorpoContratoSocial(doc, snapshot, topMargin, {
        tituloPrincipal: 'CONTRATO CONSOLIDADO',
        omitirAssinaturas: true,
        espacoAntesTitulo: 1.5,
        espacoAposTitulo: 0.8,
        nire: snapshot.nire || nire,
        cnpj: snapshot.cnpj || cnpj,
      });

      const adv = (snapshot.porte === 'Demais' && snapshot.advogado) ? snapshot.advogado : null;
      const signatarios = [...snapshot.socios_dados, ...socioSaindoParaAssinatura(proc)];
      const dataLocalFinal = `${snapshot.cidade || 'Niterói'}/${snapshot.uf || 'RJ'}, ${fmtDataExtenso(snapshot.dataContrato || null)}.`;
      drawSignBlock(doc, signatarios, adv, topMargin, dataLocalFinal);

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
    const tipo = proc.tipoProcesso || 'abertura';

    const logoBuffer = logoB64 ? Buffer.from(logoB64, 'base64') : null;

    let pdfBuffer;
    let sufixo;
    if (tipo === 'alteracao') {
      pdfBuffer = await gerarAlteracaoContratual(proc, logoBuffer, comTimbrado);
      sufixo = 'Alteracao_Contratual';
    } else if (tipo === 'abertura') {
      pdfBuffer = await gerarContratoSocial(proc, logoBuffer, comTimbrado);
      sufixo = 'Contrato_Social';
    } else {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: `Tipo de processo "${tipo}" ainda não suportado na geração de PDF pelo servidor.` }),
      };
    }

    const pdfB64 = pdfBuffer.toString('base64');
    const nomeArq = (proc.nome || 'Empresa').replace(/\s+/g, '_');

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${sufixo}_${nomeArq}.pdf"`,
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
