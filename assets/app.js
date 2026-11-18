// OJSA | navegação e telas (sem dependências).
// Funciona abrindo o index.html direto; com o servidor local (servidor/servidor.js) passa a ler o DataJud ao vivo.
(function () {
  'use strict';

  var D = window.OJSA;
  var MAPA = window.MAPA_RO;
  var DJ = window.DATAJUD || { panorama: null, processos: {} };
  var main = document.getElementById('conteudo');
  var AO_VIVO = /^https?:$/.test(location.protocol);
  var CONSULTA_TJRO = 'https://webapp.tjro.jus.br/juris/consulta/consultaJuris.jsf';

  var NATUREZA = { F: 'Fato documentado na fonte', S: 'Síntese editorial', I: 'Inferência da pesquisa' };
  var ETAPAS = ['Busca nas fontes oficiais', 'Triagem', 'Classificação', 'Revisão', 'Publicação da ficha', 'Atualização dos indicadores', 'Avaliação de tendências'];
  var MARCOS = /provimento|proced|improced|julgamento|acolhimento|embargos|recurso especial|recurso extraordin|trânsito|homologa|extinç/i;

  // ---------- utilidades ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(iso) {
    if (!iso) return null;
    var p = iso.slice(0, 10).split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function fmtMomento(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function milhar(n) { return Number(n).toLocaleString('pt-BR'); }
  function normal(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
  }
  function plural(n, um, varios) { return milhar(n) + ' ' + (n === 1 ? um : varios); }
  function eixo(id) { return D.eixos.filter(function (e) { return e.id === id; })[0]; }
  function ficha(id) { return D.fichas.filter(function (f) { return f.id === id; })[0]; }
  function tendencia(id) { return D.tendencias.filter(function (t) { return t.id === id; })[0]; }
  function grau(id) { return D.graus.filter(function (g) { return g.id === id; })[0]; }
  function anoDe(f) { return f.dataReferencia ? f.dataReferencia.slice(0, 4) : null; }
  function porData(a, b) { return (b.dataReferencia || '0') < (a.dataReferencia || '0') ? -1 : 1; }
  function nomeProcesso(f) { return f.processo || 'número não divulgado'; }

  // grafia padronizada do resultado do julgamento (o valor original do DataJud continua nos filtros)
  function rotRes(t) {
    if (!t) return t;
    var s = String(t).replace(/-/g, ' ').toLowerCase();
    return (s.charAt(0).toUpperCase() + s.slice(1)).replace(/\bcpc\b/g, 'CPC');
  }

  function contar(lista, chave) {
    var m = {};
    lista.forEach(function (item) {
      [].concat(chave(item)).forEach(function (k) { if (k != null) m[k] = (m[k] || 0) + 1; });
    });
    return Object.keys(m).map(function (k) { return { rot: k, n: m[k] }; })
      .sort(function (a, b) { return b.n - a.n || a.rot.localeCompare(b.rot, 'pt'); });
  }

  function medidor(id) {
    var nivel = ['isolado', 'observacao', 'inicial', 'sustentado'].indexOf(id) + 1;
    var s = '<span class="medidor grau-' + id + '" aria-hidden="true">';
    for (var i = 1; i <= 4; i++) s += '<i class="' + (i <= nivel ? 'cheio' : '') + '"></i>';
    return s + '</span>';
  }

  function afirmacao(a) {
    if (!a) return '';
    return '<div class="afirmacao" data-n="' + a.n + '"><p>' + esc(a.t) + '</p><span class="natureza">' + NATUREZA[a.n] + '</span></div>';
  }

  function faixa(titulo, texto, trilha, extra, classe) {
    return '<section class="faixa' + (classe ? ' ' + classe : '') + '">' +
      (trilha ? '<nav class="trilha" aria-label="Você está em">' + trilha + '</nav>' : '') +
      '<h1>' + titulo + '</h1>' + (texto ? '<p>' + texto + '</p>' : '') + (extra || '') + '</section>';
  }

  function barras(dados) {
    var max = Math.max.apply(null, dados.map(function (d) { return d.n; }).concat([1]));
    return '<table class="barras"><tbody>' + dados.map(function (d) {
      return '<tr><td class="rot">' + esc(d.rot) + '</td><td><div class="barra"><span style="width:' + (d.n / max * 100).toFixed(1) + '%"></span></div></td><td class="val">' + milhar(d.n) + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  function painel(titulo, def, dados) {
    return '<section class="painel"><h3>' + titulo + '</h3>' + (def ? '<p class="painel-def">' + def + '</p>' : '') + barras(dados) + '</section>';
  }

  function semDataJud() {
    return '<p class="vazio">Os dados do DataJud não puderam ser carregados agora. Tente de novo em alguns minutos.</p>';
  }

  function formatarNumero(n) {
    var s = String(n).replace(/\D/g, '');
    while (s.length < 20) s = '0' + s;
    return s.slice(0, 7) + '-' + s.slice(7, 9) + '.' + s.slice(9, 13) + '.' + s.slice(13, 14) + '.' + s.slice(14, 16) + '.' + s.slice(16, 20);
  }

  function fichaDoProcesso(numero) {
    return D.fichas.filter(function (f) { return f.processo === numero || (f.processosConexos || []).indexOf(numero) > -1; })[0];
  }

  // animação de carregamento: três linhas de rio correndo
  var ONDAS = '<svg viewBox="0 0 120 60" aria-hidden="true"><path class="onda onda-1" d="M4 18c12 0 14 8 26 8s14-8 26-8 14 8 26 8 14-8 26-8"/><path class="onda onda-2" d="M4 32c12 0 14 8 26 8s14-8 26-8 14 8 26 8 14-8 26-8"/><path class="onda onda-3" d="M4 46c12 0 14 8 26 8s14-8 26-8 14 8 26 8 14-8 26-8"/></svg>';
  function carregandoHtml(texto) { return '<div class="carregando-bloco" role="status">' + ONDAS + '<span>' + esc(texto) + '</span></div>'; }
  function carregador(texto) {
    var el = document.getElementById('carregador');
    if (texto) { document.getElementById('carregador-texto').textContent = texto; el.hidden = false; }
    else el.hidden = true;
  }

  // lista completa dos processos ambientais (assets/processos.json), carregada uma vez
  var processosPromessa = null;
  function carregarProcessos() {
    if (!processosPromessa) {
      var demora = setTimeout(function () { carregador('Carregando os processos do DataJud'); }, 250);
      processosPromessa = fetch('assets/processos.json').then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (j) { clearTimeout(demora); carregador(null); return j; })
        .catch(function (e) { clearTimeout(demora); carregador(null); processosPromessa = null; throw e; });
    }
    return processosPromessa;
  }

  function comarcaDe(numero) {
    var cod = String(numero).replace(/\D/g, '').slice(-4);
    if (cod === '0000') return 'protocolado direto no TJRO';
    var c = DJ.panorama && DJ.panorama.comarcas && DJ.panorama.comarcas[cod];
    return c ? c.toLowerCase().replace(/(^|[\s'-])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); }).replace(/\b(De|Do|Da|Dos|Das|E)\b/g, function (p) { return p.toLowerCase(); }) : null;
  }

  // ---------- componentes ----------
  function itemDecisao(f) {
    var lugar = f.municipio ? f.municipio.nome : f.territorio;
    return '<li class="decisao"><a class="decisao-link" href="#/decisoes/' + f.id + '">' +
      '<span class="decisao-data">' + esc(fmt(f.dataReferencia) || 'Sem data') + '<small>' + esc(f.tipoData) + '</small></span>' +
      '<span><span class="decisao-titulo">' + esc(f.titulo) + '</span>' +
      '<span class="decisao-meta">' + esc([f.classe, f.orgao, lugar].filter(Boolean).join(', ')) + '</span></span>' +
      '<span class="decisao-lado"><span class="selo">' + esc(f.resultado) + '</span></span>' +
      '</a></li>';
  }

  // Mapa: modo "fichas" (acervo analisado) ou "datajud" (processos por comarca de origem)
  function contagemMapa(modo) {
    var n = {};
    if (modo === 'fichas') {
      D.fichas.forEach(function (f) { if (f.municipio) n[f.municipio.id] = (n[f.municipio.id] || 0) + 1; });
      return n;
    }
    if (!DJ.panorama) return n;
    var porNome = {};
    MAPA.municipios.forEach(function (m) { porNome[normal(m.nome)] = m.id; });
    DJ.panorama.porComarca.forEach(function (c) {
      var id = porNome[normal(c.rot)];
      if (id) n[id] = c.n;
    });
    return n;
  }

  function mapa(modo) {
    var n = contagemMapa(modo);
    var valores = Object.keys(n).map(function (k) { return n[k]; }).sort(function (a, b) { return a - b; });
    var max = valores[valores.length - 1] || 1;
    // cores diferentes por camada: verdes para a sede da comarca, terra para o local do impacto
    var tons = ['#C9DED1', '#94BFA5', '#5E9C7A', '#2F6B52', '#1E4A3B'];
    var TERRA = { pouco: '#D9A55A', muito: '#8C5A22' };
    function tom(v) {
      if (modo === 'fichas') return v >= 3 ? TERRA.muito : TERRA.pouco;
      var i = Math.min(4, Math.floor(Math.log(v) / Math.log(max + 1) * 5));
      return tons[i];
    }
    var rotular = modo === 'fichas' ? function () { return true; } : (function () {
      var top = Object.keys(n).sort(function (a, b) { return n[b] - n[a]; }).slice(0, 5);
      return function (id) { return top.indexOf(id) > -1; };
    })();

    var paths = '', rotulos = '';
    MAPA.municipios.forEach(function (m) {
      var k = n[m.id];
      var rotulo = esc(m.nome) + (k ? ': ' + plural(k, modo === 'fichas' ? 'decisão' : 'processo', modo === 'fichas' ? 'decisões' : 'processos') : '');
      if (k && modo === 'fichas') {
        paths += '<path d="' + m.d + '" style="fill:' + tom(k) + '" data-mun="' + m.id + '" tabindex="0" role="link" aria-label="' + rotulo + '"><title>' + rotulo + '</title></path>';
      } else {
        paths += '<path d="' + m.d + '"' + (k ? ' style="fill:' + tom(k) + ';stroke:#fff"' : '') + '><title>' + rotulo + '</title></path>';
      }
      if (k && rotular(m.id)) {
        var esquerda = m.cx > MAPA.largura * 0.6 || m.nome === 'Porto Velho';
        rotulos += '<text class="rotulo" x="' + (esquerda ? m.cx - 18 : m.cx + 18) + '" y="' + (m.cy + 10) + '" text-anchor="' + (esquerda ? 'end' : 'start') + '">' + esc(m.nome) + ' <tspan class="rotulo-n">' + milhar(k) + '</tspan></text>';
      }
    });

    // legenda permanente: diz sempre se a área marcada é a sede da comarca ou o local do impacto territorial
    var camada, legenda, fora;
    if (modo === 'fichas') {
      camada = '<div class="mapa-camada camada-impacto"><span class="mapa-camada-marca" aria-hidden="true"></span><div><strong>Local do impacto</strong>' +
        '<span>Município associado ao impacto descrito na decisão.</span></div></div>';
      legenda = '<span><i style="background:' + TERRA.muito + '"></i>3 ou mais decisões</span><span><i style="background:' + TERRA.pouco + '"></i>1 ou 2 decisões</span><span><i style="background:#F3F5F4"></i>sem decisões</span>';
      var estadual = D.fichas.filter(function (f) { return !f.municipio; }).length;
      fora = estadual ? 'Fora do mapa: ' + plural(estadual, 'decisão de alcance estadual', 'decisões de alcance estadual') + '.' : '';
    } else {
      camada = '<div class="mapa-camada camada-comarca"><span class="mapa-camada-marca" aria-hidden="true"></span><div><strong>Sede da comarca</strong>' +
        '<span>Município da sede da comarca de origem do processo.</span></div></div>';
      legenda = '<span><i style="background:' + tons[0] + '"></i>menos processos</span><span><i style="background:' + tons[4] + '"></i>mais processos</span><span><i style="background:#F3F5F4"></i>sem processos</span>';
      var semLugar = DJ.panorama ? DJ.panorama.porComarca.filter(function (c) { return /protocolado|não identificada/i.test(c.rot); }).reduce(function (s, c) { return s + c.n; }, 0) : 0;
      fora = semLugar ? 'Fora do mapa: ' + plural(semLugar, 'processo protocolado diretamente no TJRO ou sem comarca identificada', 'processos protocolados diretamente no TJRO ou sem comarca identificada') + '.' : '';
    }
    return '<figure style="margin:0">' + camada +
      '<svg class="mapa-ro" viewBox="0 0 ' + MAPA.largura + ' ' + MAPA.altura + '" role="img" aria-label="Mapa de Rondônia por município: ' + (modo === 'fichas' ? 'local do impacto territorial' : 'sede da comarca de origem') + '">' + paths + rotulos + '</svg>' +
      '<figcaption><div class="mapa-legenda">' + legenda + '</div><p class="mapa-nota">' + (fora ? fora + ' ' : '') + 'Fonte: ' + (modo === 'fichas' ? 'fichas do Observatório' : 'DataJud (CNJ)') + ' e IBGE.</p></figcaption></figure>';
  }

  function ligarMapa() {
    [].forEach.call(main.querySelectorAll('path[data-mun]'), function (p) {
      function ir() { location.hash = '#/decisoes?municipio=' + p.getAttribute('data-mun'); }
      p.addEventListener('click', ir);
      p.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } });
    });
  }

  function listaEixos() {
    return '<ul class="eixos">' + D.eixos.map(function (e) {
      var n = D.fichas.filter(function (f) { return f.eixos.indexOf(e.id) > -1; }).length;
      return '<li class="eixo"><a href="#/temas/' + e.id + '"><span class="eixo-nome">' + esc(e.nome) + '</span>' +
        '<span class="eixo-resumo">' + esc(e.resumo) + '</span>' +
        '<span class="eixo-n"><b>' + n + '</b>' + (n === 1 ? 'decisão' : 'decisões') + '</span></a></li>';
    }).join('') + '</ul>';
  }

  function blocoMapas(comBarras) {
    var P = DJ.panorama;
    return '<div class="mapas-lado">' +
        (P ? '<div class="mapa-bloco"><h3 class="mapa-titulo titulo-comarca">Processos do 2º grau por comarca de origem</h3>' +
          '<p class="mapa-porque">Processos identificados no DataJud por assunto ambiental, agrupados pela comarca de origem indicada no número do processo. A sede da comarca não indica necessariamente onde ocorreu o impacto.</p>' + mapa('datajud') +
          (comBarras ? '<h4>Comarcas de origem com mais processos</h4>' + barras(P.porComarca.slice(0, 6)) : '') + '</div>' : '') +
        '<div class="mapa-bloco"><h3 class="mapa-titulo titulo-impacto">Decisões analisadas por município do impacto</h3>' +
          '<p class="mapa-porque">Decisões examinadas pela pesquisa, distribuídas conforme o município do impacto identificado em seu texto. O número representa decisões, não conflitos distintos.</p>' + mapa('fichas') +
          (comBarras ? '<h4>Decisões por município do impacto</h4><div class="barras-terra">' + barras(contar(D.fichas, function (f) { return f.municipio ? f.municipio.nome : 'Abrangência estadual'; })) + '</div>' : '') + '</div>' +
      '</div>';
  }

  function textoMapas() {
    var P = DJ.panorama;
    return '<p class="mapas-explica">' + (P ? 'O mapa da esquerda conta <b>todos os ' + milhar(P.civeis) + ' processos ambientais</b> do TJRO pela comarca onde começaram. ' : '') +
      'O da direita mostra só <b>as ' + D.fichas.length + ' decisões já analisadas</b> pela pesquisa, no lugar do conflito. Por isso os números são tão diferentes: um é o universo de processos; o outro, o acervo analisado, que cresce a cada triagem.</p>';
  }

  // Em pauta: notícias e atos com data, fonte e link (assets/pauta.js)
  function pauta() { return (window.OJSA_PAUTA || []).slice().sort(function (a, b) { return b.ordem.localeCompare(a.ordem); }); }
  function itemPauta(p) {
    var capa = p.foto
      ? '<div class="noticia-capa"><img src="' + esc(p.foto) + '" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="noticia-credito">' + esc(p.credito || '') + '</span></div>'
      : '<div class="noticia-capa noticia-sem-foto tipo-' + esc(p.tipo || 'imprensa') + '"><span class="noticia-selo">' + (p.tipo === 'justica' ? 'Justiça' : 'Imprensa') + '</span><strong>' + esc(p.fonte) + '</strong></div>';
    return '<article class="noticia">' + capa +
      '<div class="noticia-corpo"><p class="noticia-meta"><time>' + esc(p.quando) + '</time> · ' + esc(p.fonte) + '</p>' +
      '<h3><a href="' + esc(p.link) + '" target="_blank" rel="noopener">' + esc(p.titulo) + '</a></h3>' +
      '<p>' + esc(p.texto) + '</p>' +
      '<a class="noticia-link" href="' + esc(p.link) + '" target="_blank" rel="noopener">Ler na fonte</a></div></article>';
  }
  function telaPauta() {
    main.innerHTML =
      faixa('Em pauta', 'Notícias sobre conflitos e justiça socioambiental na Amazônia, com data, fonte e link para a matéria original.', '<a href="#/radar">Radar Jurisprudencial</a> / Em pauta') +
      '<div class="miolo"><div class="pauta-grade">' + pauta().map(itemPauta).join('') + '</div>' +
      '<p class="nota" style="margin-top:18px">Resumos do Observatório. A matéria completa está na fonte.</p></div>';
  }

  // ---------- telas ----------
  function telaInicio() {
    main.innerHTML =
      faixa('Territórios, Direitos e Justiça na Amazônia',
        'Dados e análises sobre conflitos socioambientais nas decisões do Tribunal de Justiça de Rondônia.', '',
        '<p class="faixa-botoes"><a class="botao botao-ouro" href="#/sobre">Conheça o Observatório</a><a class="botao botao-vazado" href="#/temas">Veja conflitos e territórios</a></p>', 'faixa-inicio') +

      '<div class="miolo">' +
        '<section class="secao obs-secao"><h2 class="obs-titulo">O Observatório</h2>' +
          '<p class="obs-texto">O Observatório da Justiça Socioambiental na Amazônia é uma iniciativa de pesquisa vinculada ao DHJUS/UNIR. Reúne e analisa decisões do TJRO para mostrar quais questões socioambientais chegam à Justiça, quais territórios estão envolvidos e como essas questões são decididas.</p>' +
          '<p class="obs-mais"><a href="#/sobre">Apresentação completa</a></p>' +
          '<div class="sobre-resumo">' +
            '<div><h3>O que analisamos</h3><p>Decisões judiciais sobre questões socioambientais em Rondônia, considerando os temas discutidos, os territórios envolvidos e as respostas do Judiciário.</p></div>' +
            '<div><h3>Como analisamos</h3><p>Selecionamos e classificamos decisões com critérios de pesquisa definidos e indicamos as fontes das informações apresentadas.</p></div>' +
            '<div><h3>Por que isso importa</h3><p>Os dados ajudam a compreender quais questões chegam à Justiça e a identificar padrões e limites das respostas judiciais.</p></div>' +
          '</div>' +
        '</section>' +

        '<section class="secao"><div class="secao-cabeca"><h2>Do processo ao território do impacto</h2><a href="#/temas">Conflitos e territórios</a></div>' + blocoMapas(false) + '</section>' +

        '<section class="secao"><div class="secao-cabeca"><h2>No Radar Jurisprudencial</h2><a href="#/radar/tendencias">Todas as tendências</a></div>' +
          D.tendencias.slice(0, 3).map(function (t) {
            return '<article class="tendencia grau-' + t.grau + '"><div class="tendencia-topo"><h3>' + esc(t.titulo) + '</h3><span class="tendencia-grau grau-' + t.grau + '">' + medidor(t.grau) + esc(grau(t.grau).nome) + '</span></div>' +
              '<div class="tendencia-fatos"><span><b>Amostra:</b> ' + plural(t.fichas.length, 'ficha', 'fichas') + '</span><span><b>Órgão:</b> ' + esc(t.orgaos) + '</span><span><b>Período:</b> ' + esc(t.periodo) + '</span></div></article>';
          }).join('') +
        '</section>' +

        '<section class="secao"><div class="secao-cabeca"><h2>Em pauta</h2><a href="#/em-pauta">Tudo em pauta</a></div>' +
          '<div class="pauta-grade">' + pauta().slice(0, 3).map(itemPauta).join('') + '</div>' +
        '</section>' +

      '</div>';
  }

  // Temas e Territórios
  function telaTemas() {
    var P = DJ.panorama;
    main.innerHTML =
      faixa('Conflitos e territórios', 'Mapas dos processos e das decisões analisadas, e os eixos temáticos da pesquisa.') +
      '<div class="miolo">' +
        '<section class="secao"><div class="secao-cabeca"><h2>Do processo ao território do impacto</h2></div>' + blocoMapas(true) + '</section>' +
        '<section class="secao"><div class="secao-cabeca"><h2>Eixos temáticos da pesquisa</h2><p>Categorias usadas para classificar as decisões analisadas.</p></div>' + listaEixos() + '</section>' +
      '</div>';
    ligarMapa();
  }

  function telaTema(id) {
    var e = eixo(id);
    if (!e) return telaNaoEncontrada();
    var fichas = D.fichas.filter(function (f) { return f.eixos.indexOf(id) > -1; }).sort(porData);
    var ids = fichas.map(function (f) { return f.id; });
    var tend = D.tendencias.filter(function (t) { return t.fichas.some(function (x) { return ids.indexOf(x) > -1; }); });
    var etiquetas = function (l) { return '<ul class="etiquetas">' + l.map(function (x) { return '<li class="selo selo-eixo">' + esc(x) + '</li>'; }).join('') + '</ul>'; };

    main.innerHTML =
      faixa(esc(e.nome), esc(e.texto), '<a href="#/temas">Conflitos e territórios</a> / ' + esc(e.curto)) +
      '<div class="miolo"><div class="duas">' +
        '<section><div class="secao-cabeca"><h2>' + plural(fichas.length, 'decisão', 'decisões') + '</h2><a href="#/decisoes?eixo=' + id + '">Filtrar no acervo</a></div>' +
          (fichas.length ? '<ul class="lista-decisoes">' + fichas.map(itemDecisao).join('') + '</ul>' : '<p class="vazio">Ainda não há decisões neste eixo. A página cresce conforme o acervo é classificado.</p>') +
        '</section>' +
        '<section>' +
          '<div class="secao-cabeca"><h2>Principais atores</h2></div>' + etiquetas(e.atores) +
          '<div class="secao-cabeca" style="margin-top:32px"><h2>Direitos em discussão</h2></div>' + etiquetas(e.direitos) +
          '<div class="secao-cabeca" style="margin-top:32px"><h2>Tendências relacionadas</h2></div>' +
          (tend.length ? '<ul>' + tend.map(function (t) { return '<li><a href="#/radar/tendencias">' + esc(t.titulo) + '</a> (' + esc(grau(t.grau).nome.toLowerCase()) + ')</li>'; }).join('') + '</ul>'
            : '<p class="nota">Ainda não há evidência suficiente para apontar tendência neste eixo.</p>') +
        '</section>' +
      '</div></div>';
  }

  function telaBiblioteca() {
    main.innerHTML =
      faixa('Fontes e método', 'Como a pesquisa trabalha e de onde vêm os dados: método, critérios, legislação, bases públicas e leituras de referência.') +
      '<div class="miolo">' +
      '<section class="secao"><div class="atalhos-metodo">' +
        '<a href="#/sobre/metodologia"><strong>Metodologia</strong><span>Como as decisões são selecionadas, classificadas e revisadas.</span></a>' +
        '<a href="#/indicadores/criterios"><strong>Critérios dos indicadores</strong><span>Fonte, recorte e definições dos números do site.</span></a>' +
        '<a href="#/dados"><strong>Dados abertos (API)</strong><span>Os dados do Observatório em formato JSON, sem cadastro.</span></a>' +
      '</div></section>' + D.biblioteca.map(function (g) {
        return '<section class="secao" id="' + g.id + '"><div class="secao-cabeca"><h2>' + esc(g.grupo) + '</h2></div><ul class="biblio">' + g.itens.map(function (i) {
          return '<li>' + (i.url ? '<a href="' + esc(i.url) + '" target="_blank" rel="noopener">' + esc(i.t) + '</a>' : esc(i.t)) + '<span class="desc">' + esc(i.d) + '</span></li>';
        }).join('') + '</ul></section>';
      }).join('') + '</div>';
  }

  function telaSobre() {
    main.innerHTML =
      faixa('O Observatório', 'Apresentação, objetivos, equipe, metodologia e escopo.') +
      '<div class="miolo"><div class="texto">' +
      '<h2 id="apresentacao">Apresentação</h2>' +
      '<p>O Observatório da Justiça Socioambiental na Amazônia acompanha como o Tribunal de Justiça de Rondônia responde aos conflitos socioambientais que chegam a ele. A Amazônia é o horizonte da pesquisa; a base empírica inicial são os acórdãos do TJRO.</p>' +
      '<p>É produto técnico-tecnológico de pesquisa de doutorado no Programa de Pós-Graduação em Direitos Humanos e Desenvolvimento da Justiça (DHJUS) da Universidade Federal de Rondônia. Não é um canal do Tribunal de Justiça de Rondônia, e suas análises não representam posição oficial do tribunal.</p>' +

      '<h2 id="objetivos">Objetivos</h2><ul>' +
        '<li>Reunir acórdãos sobre conflitos socioambientais em fichas padronizadas e rastreáveis.</li>' +
        '<li>Acompanhar a evolução dos entendimentos, com grau de evidência e ressalvas.</li>' +
        '<li>Oferecer indicadores com fonte, período, recorte e definições sempre visíveis.</li>' +
        '<li>Ligar as decisões aos territórios e aos grupos atingidos.</li></ul>' +

      '<h2 id="equipe">Equipe</h2><div class="equipe">' +
        '<div class="pessoa"><img class="pessoa-foto" src="assets/equipe/samia.jpg" alt="Sâmia Souza Santos"><div><strong>Sâmia Souza Santos</strong><span>Pesquisadora responsável. Doutoranda no Programa de Pós-Graduação em Direitos Humanos e Desenvolvimento da Justiça (DHJUS) da Universidade Federal de Rondônia.</span></div></div>' +
        '<div class="pessoa"><img class="pessoa-foto" src="assets/equipe/adriana.jpg" alt="Dra. Adriana Vieira da Costa"><div><strong>Dra. Adriana Vieira da Costa</strong><span>Orientadora da pesquisa no DHJUS/UNIR.</span></div></div>' +
      '</div>' +

      '<h2 id="metodologia">Metodologia</h2>' +
      '<p>Toda ficha percorre o mesmo fluxo antes de ser publicada:</p><ol class="fluxo">' + ETAPAS.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ol>' +
      '<p style="margin-top:16px">A ficha tem seis grupos de dados: identificação, conflito, aspectos jurídicos, justiça socioambiental, monitoramento e fontes. Em cada um, o que vem da fonte aparece separado do que é síntese da equipe e do que é inferência da pesquisa.</p>' +
      '<p>Os dados processuais (classe, órgão, assuntos e movimentos) vêm da API Pública do DataJud, mantida pelo Conselho Nacional de Justiça. O conteúdo das decisões vem de notícias institucionais do TJRO, de bases acadêmicas e, quando disponível, do inteiro teor do acórdão.</p>' +
      '<p>O Observatório não avalia o cumprimento ou a efetividade prática das decisões sem pesquisa adicional.</p>' +

      '<h2 id="escopo">Escopo</h2><p>Conflitos socioambientais judicializados no TJRO: grandes empreendimentos, águas e comunidades, territórios tradicionais e áreas protegidas, disputas fundiárias e danos socioambientais.</p>' +
      '<h2 id="atualizacoes">Atualizações</h2><p>Rotina mensal, com boletim do Radar. Os indicadores do DataJud são atualizados a cada consulta ao CNJ.</p>' +
      '<h2 id="privacidade">Privacidade</h2><p>Nas fichas analíticas, pessoas físicas aparecem pelas iniciais. São usadas apenas informações já públicas em fontes oficiais e jornalísticas. Na página de cada processo, os textos do Diário de Justiça Eletrônico Nacional são reproduzidos como foram publicados oficialmente pelo tribunal.</p>' +
      '</div></div>';
  }

  // Cadastro de ficha (área da equipe)
  function telaCadastro() {
    var CHAVE = 'ojsa-rascunho-ficha';
    var grupos = [
      { nome: 'Identificação', campos: [
        ['processo', 'Número do processo', 'text', true, 'Formato CNJ: 0000000-00.0000.8.22.0000'],
        ['classe', 'Classe processual', 'text', true],
        ['orgao', 'Órgão julgador', 'select', true, '', ['1ª Câmara Cível', '2ª Câmara Cível', '1ª Câmara Especial', '2ª Câmara Especial', 'Tribunal Pleno', 'Outro']],
        ['relatoria', 'Relatoria', 'text', true],
        ['julgamento', 'Data do julgamento', 'date', true],
        ['publicacao', 'Data da publicação', 'date', false],
        ['link', 'Link oficial do acórdão', 'url', true, 'Endereço na consulta de jurisprudência do TJRO'],
        ['coleta', 'Data da coleta', 'date', true]
      ]},
      { nome: 'Conflito', campos: [
        ['eixo', 'Eixo temático', 'select', true, '', D.eixos.map(function (e) { return e.nome; })],
        ['subtema', 'Subtema', 'text', false],
        ['municipio', 'Município ou território', 'text', false, 'Só quando identificável na fonte'],
        ['atores', 'Atores e grupos atingidos', 'text', false],
        ['sintese', 'Síntese dos fatos', 'textarea', true]
      ]},
      { nome: 'Aspectos jurídicos', campos: [
        ['direitos', 'Direitos em discussão', 'text', false],
        ['fundamentos', 'Fundamentos da decisão', 'textarea', true],
        ['precedentes', 'Precedentes invocados', 'text', false],
        ['resultado', 'Resultado', 'select', true, '', ['Recurso provido', 'Recurso parcialmente provido', 'Recurso desprovido', 'Pedido procedente', 'Pedido improcedente', 'Outro']],
        ['providencias', 'Providências determinadas', 'textarea', false]
      ]},
      { nome: 'Justiça socioambiental', campos: [
        ['distribuicao', 'Indícios de distribuição de impactos', 'textarea', false, 'Registre como inferência da pesquisa'],
        ['reconhecimento', 'Indícios de reconhecimento de grupos', 'textarea', false],
        ['participacao', 'Indícios de participação e acesso à justiça', 'textarea', false]
      ]},
      { nome: 'Fontes e revisão', campos: [
        ['fonte', 'Fonte', 'url', true],
        ['trecho', 'Trecho comprobatório', 'textarea', true, 'Copie o trecho literal do acórdão'],
        ['pesquisador', 'Pesquisador responsável', 'text', true],
        ['etapa', 'Etapa da revisão', 'select', true, '', ETAPAS.slice(1, 5)]
      ]}
    ];

    var salvo = {};
    try { salvo = JSON.parse(localStorage.getItem(CHAVE) || '{}'); } catch (e) { salvo = {}; }

    function campo(c) {
      var id = 'c-' + c[0], v = salvo[c[0]] || '', obrig = c[3];
      var rot = '<label for="' + id + '">' + esc(c[1]) + (obrig ? '<span class="obrig">obrigatório</span>' : '') + '</label>';
      var ajuda = c[4] ? '<span class="ajuda" id="' + id + '-ajuda">' + esc(c[4]) + '</span>' : '';
      var attrs = ' id="' + id + '" name="' + c[0] + '"' + (obrig ? ' required' : '') + (c[4] ? ' aria-describedby="' + id + '-ajuda"' : '');
      var input;
      if (c[2] === 'select') input = '<select' + attrs + '><option value="">Escolha</option>' + c[5].map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      else if (c[2] === 'textarea') input = '<textarea' + attrs + '>' + esc(v) + '</textarea>';
      else input = '<input type="' + c[2] + '"' + attrs + ' value="' + esc(v) + '">';
      return '<div class="campo' + (c[2] === 'textarea' ? ' largo' : '') + '">' + rot + input + ajuda + '<span class="erro" hidden></span></div>';
    }

    main.innerHTML =
      faixa('Cadastrar ficha de acórdão', 'Área da equipe. Todo dado analítico precisa ser rastreável ao documento de origem.') +
      '<div class="miolo"><form class="formulario" id="form-ficha" novalidate>' +
        grupos.map(function (g) { return '<fieldset class="form-grupo"><legend>' + g.nome + '</legend><div class="campos">' + g.campos.map(campo).join('') + '</div></fieldset>'; }).join('') +
        '<div class="form-acoes"><button class="botao" type="submit">Conferir campos obrigatórios</button><button class="botao botao-claro" type="button" id="salvar">Salvar rascunho neste navegador</button></div>' +
        '<div class="mensagem" id="msg" role="status" hidden></div>' +
      '</form></div>';

    var form = document.getElementById('form-ficha');
    var msg = document.getElementById('msg');
    function avisar(t) { msg.hidden = false; msg.textContent = t; }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var faltando = 0, primeiro = null;
      [].forEach.call(form.querySelectorAll('[required]'), function (el) {
        var ok = el.value.trim() !== '' && el.checkValidity();
        var erro = el.parentNode.querySelector('.erro');
        el.setAttribute('aria-invalid', ok ? 'false' : 'true');
        erro.hidden = ok;
        erro.textContent = ok ? '' : (el.value.trim() === '' ? 'Preencha este campo.' : 'Confira o formato.');
        if (!ok) { faltando++; primeiro = primeiro || el; }
      });
      if (faltando) { avisar(plural(faltando, 'campo obrigatório precisa', 'campos obrigatórios precisam') + ' de atenção.'); primeiro.focus(); }
      else avisar('Todos os campos obrigatórios estão preenchidos. A ficha pode seguir para revisão.');
    });
    document.getElementById('salvar').addEventListener('click', function () {
      var dados = {};
      [].forEach.call(form.elements, function (el) { if (el.name) dados[el.name] = el.value; });
      try { localStorage.setItem(CHAVE, JSON.stringify(dados)); avisar('Rascunho salvo neste navegador.'); }
      catch (e) { avisar('Este navegador não permitiu salvar o rascunho. Os dados continuam no formulário enquanto a página estiver aberta.'); }
    });
  }

  // Dados abertos: documentação da API
  function telaDados() {
    var raiz = location.origin && /^https?:/.test(location.origin) ? location.origin : 'https://endereco-do-observatorio';
    var exemplo = D.fichas.filter(function (f) { return f.processo; })[0];
    var enderecos = [
      ['/api/v1', 'Descrição da API, data da última atualização e lista de endereços.'],
      ['/api/v1/fichas', 'Todas as decisões do acervo, com os dados de identificação. Filtros opcionais: eixo, municipio, orgao, resultado e q (busca por palavra).'],
      ['/api/v1/fichas?eixo=aguas', 'Exemplo de filtro: decisões do eixo Águas, rios e comunidades.'],
      ['/api/v1/fichas/' + exemplo.id, 'Ficha completa de uma decisão, com fundamentos, dimensões de justiça socioambiental e fontes.'],
      ['/api/v1/eixos', 'Eixos temáticos, com atores, direitos e decisões de cada um.'],
      ['/api/v1/radar', 'Tendências em análise, graus de evidência, divergências e precedentes.'],
      ['/api/v1/panorama', 'Panorama dos processos ambientais do 2º grau do TJRO, atualizado todo dia a partir do DataJud.'],
      ['/api/v1/processos?situacao=julgado&comarca=Porto Velho', 'Lista dos processos ambientais do 2º grau do TJRO, com filtros (esfera, classe, assunto, comarca, ano, situacao, resultado, q) e páginas (pagina, por).'],
      ['/api/v1/processos/' + exemplo.processo, 'Andamento de qualquer processo do TJRO, consultado ao vivo na API Pública do DataJud (CNJ).'],
      ['/api/v1/publicacoes/' + exemplo.processo, 'Publicações do processo no Diário de Justiça Eletrônico Nacional (CNJ), com links para os documentos no PJe.']
    ];
    main.innerHTML =
      faixa('Dados abertos', 'Os dados do Observatório podem ser usados por outros pesquisadores e sistemas, em formato JSON, sem cadastro.', '<a href="#/biblioteca">Fontes e método</a> / Dados abertos') +
      '<div class="miolo"><div class="texto">' +
      '<h2>Endereços da API</h2>' +
      '<table class="tabela"><thead><tr><th>Endereço</th><th>O que devolve</th></tr></thead><tbody>' +
      enderecos.map(function (e) { return '<tr><td class="forte"><a href="' + esc(e[0]) + '" target="_blank" rel="noopener">' + esc(e[0]) + '</a></td><td>' + esc(e[1]) + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      '<h2>Como usar</h2><p>Qualquer navegador ou linguagem de programação lê os endereços acima. Por exemplo, no terminal:</p>' +
      '<p><code>curl ' + esc(raiz) + '/api/v1/fichas</code></p>' +
      '<p>As respostas aceitam chamadas de outros sites. A consulta de processos depende da disponibilidade do DataJud; quando o CNJ não responde, a API devolve a última cópia salva, se houver.</p>' +
      '<h2>Como citar</h2><p>Observatório da Justiça Socioambiental na Amazônia (OJSA). Programa de Pós-Graduação em Direitos Humanos e Desenvolvimento da Justiça, Universidade Federal de Rondônia. Informe o endereço consultado e a data de acesso.</p>' +
      '<h2>Origem dos dados</h2><p>Fichas: notícias institucionais do TJRO, bases acadêmicas de litígios e API Pública do DataJud, com a natureza de cada afirmação indicada. Panorama e andamentos: API Pública do DataJud, mantida pelo Conselho Nacional de Justiça. Limites municipais: IBGE.</p>' +
      '</div></div>';
  }

  function telaNaoEncontrada() {
    main.innerHTML = faixa('Página não encontrada', '') + '<div class="miolo"><p>Esse endereço não existe. <a href="#/">Voltar ao início</a> ou <a href="#/decisoes">consultar as decisões</a>.</p></div>';
  }

  // ---------- roteamento ----------
  var raizAtual = null;
  function rotear(manterRolagem) {
    var hash = location.hash.replace(/^#/, '') || '/';
    var partes = hash.split('?');
    var caminho = partes[0].split('/').filter(Boolean);
    var qs = new URLSearchParams(partes[1] || '');
    var raiz = caminho[0] || 'inicio';
    var secao = caminho[1];
    var rolagem = window.scrollY;

    if (raiz === 'inicio') telaInicio();
    else if (raiz === 'decisoes' && secao) telaFicha(secao);
    else if (raiz === 'decisoes') telaDecisoes(qs);
    else if (raiz === 'processos' && secao) telaProcesso(secao);
    else if (raiz === 'processos') telaProcessos(qs);
    else if (raiz === 'radar' && secao === 'boletim') telaBoletim();
    else if (raiz === 'radar') telaRadar();
    else if (raiz === 'indicadores') telaIndicadores();
    else if (raiz === 'temas' && secao) telaTema(secao);
    else if (raiz === 'temas') telaTemas();
    else if (raiz === 'biblioteca') telaBiblioteca();
    else if (raiz === 'sobre') telaSobre();
    else if (raiz === 'dados') telaDados();
    else if (raiz === 'em-pauta') telaPauta();
    else if (raiz === 'equipe') telaCadastro();
    else telaNaoEncontrada();
    raizAtual = raiz;

    [].forEach.call(document.querySelectorAll('.menu-lista > li'), function (li) {
      li.classList.toggle('ativo', li.getAttribute('data-rota') === ({ dados: 'biblioteca', radar: 'decisoes', 'em-pauta': 'temas' }[raiz] || raiz));
    });
    // transição suave entre páginas
    if (manterRolagem !== true) { main.classList.remove('entrando'); void main.offsetWidth; main.classList.add('entrando'); }
    document.getElementById('menu').classList.remove('aberto');
    document.querySelector('.menu-botao').setAttribute('aria-expanded', 'false');
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.menu')) document.activeElement.blur();

    if (manterRolagem === true) { window.scrollTo(0, rolagem); return; }
    var alvo = secao && ['radar', 'indicadores', 'biblioteca', 'sobre'].indexOf(raiz) > -1 && document.getElementById(secao);
    if (alvo) alvo.scrollIntoView();
    else window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }

  // submenu de Temas a partir dos eixos
  document.getElementById('sub-temas').innerHTML = '<li><a href="#/temas">Mapas: comarca de origem e município do impacto</a></li>' +
    '<li class="sub-rotulo">Eixos temáticos da pesquisa</li>' +
    D.eixos.map(function (e) { return '<li><a href="#/temas/' + e.id + '">' + esc(e.nome) + '</a></li>'; }).join('') +
    '<li class="sub-separa"><a href="#/em-pauta">Em pauta: notícias</a></li>';

  document.querySelector('.menu-botao').addEventListener('click', function () {
    var aberto = document.getElementById('menu').classList.toggle('aberto');
    this.setAttribute('aria-expanded', aberto ? 'true' : 'false');
  });

  // mesmo hash clicado de novo (ex.: submenu da página atual) deve rolar até a seção
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#/"]');
    if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); rotear(); }
  });

  window.addEventListener('hashchange', function () { rotear(); });
  rotear();
})();
