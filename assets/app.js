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
      var rotulo = esc(m.nome) + (k ? ': ' + plural(k, modo === 'fichas' ? 'ficha' : 'processo', modo === 'fichas' ? 'fichas' : 'processos') : '');
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
      camada = '<div class="mapa-camada camada-impacto"><span class="mapa-camada-marca" aria-hidden="true"></span><div><strong>Local do conflito</strong>' +
        '<span>Município identificado nas fontes consultadas para a ficha.</span></div></div>';
      legenda = '<span><i style="background:' + TERRA.muito + '"></i>3 ou mais fichas</span><span><i style="background:' + TERRA.pouco + '"></i>1 ou 2 fichas</span><span><i style="background:#F3F5F4"></i>sem fichas</span>';
      var estadual = D.fichas.filter(function (f) { return !f.municipio; }).length;
      fora = estadual ? 'Fora do mapa: ' + plural(estadual, 'ficha de alcance estadual', 'fichas de alcance estadual') + '.' : '';
    } else {
      camada = '<div class="mapa-camada camada-comarca"><span class="mapa-camada-marca" aria-hidden="true"></span><div><strong>Sede da comarca</strong>' +
        '<span>Município da unidade judicial de origem do processo.</span></div></div>';
      legenda = '<span><i style="background:' + tons[0] + '"></i>menos processos</span><span><i style="background:' + tons[4] + '"></i>mais processos</span><span><i style="background:#F3F5F4"></i>sem processos</span>';
      var semLugar = DJ.panorama ? DJ.panorama.porComarca.filter(function (c) { return /protocolado|não identificada/i.test(c.rot); }).reduce(function (s, c) { return s + c.n; }, 0) : 0;
      fora = semLugar ? 'Fora do mapa: ' + plural(semLugar, 'processo protocolado diretamente no TJRO ou sem comarca identificada', 'processos protocolados diretamente no TJRO ou sem comarca identificada') + '.' : '';
    }
    return '<figure style="margin:0">' + camada +
      '<svg class="mapa-ro" viewBox="0 0 ' + MAPA.largura + ' ' + MAPA.altura + '" role="img" aria-label="Mapa de Rondônia por município: ' + (modo === 'fichas' ? 'local do conflito' : 'sede da comarca de origem') + '">' + paths + rotulos + '</svg>' +
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
    return '<p class="mapas-explica">Os mapas oferecem duas perspectivas: onde os processos começaram e quais locais estão relacionados aos casos apresentados nas fichas.</p>' +
      '<div class="mapas-lado">' +
        (P ? '<div class="mapa-bloco"><h3 class="mapa-titulo titulo-comarca">Processos por comarca de origem</h3>' +
          mapa('datajud') +
          (comBarras ? '<h4>Comarcas de origem com mais processos</h4>' + barras(P.porComarca.slice(0, 6)) : '') + '</div>' : '') +
        '<div class="mapa-bloco"><h3 class="mapa-titulo titulo-impacto">Fichas por local do conflito</h3>' +
          mapa('fichas') +
          (comBarras ? '<h4>Fichas por município</h4><div class="barras-terra">' + barras(contar(D.fichas, function (f) { return f.municipio ? f.municipio.nome : 'Abrangência estadual'; })) + '</div>' : '') + '</div>' +
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
      faixa('Em pauta', 'Notícias sobre conflitos e justiça socioambiental na Amazônia, com data, fonte e link para a matéria original.', '<a href="#/temas">Conflitos e territórios</a> / Em pauta') +
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
          '<p class="obs-texto">O Observatório da Justiça Socioambiental na Amazônia é uma plataforma pública de pesquisa do DHJUS/UNIR. Reúne e organiza decisões do Tribunal de Justiça de Rondônia sobre conflitos socioambientais, com os territórios envolvidos, os direitos em disputa e a fonte de cada informação.</p>' +
          '<p class="obs-mais"><a href="#/sobre">Apresentação completa</a></p>' +
          '<div class="sobre-resumo">' +
            '<div><h3>O que analisamos</h3><p>Acórdãos cíveis do TJRO sobre conflitos socioambientais.</p></div>' +
            '<div><h3>Como analisamos</h3><p>Em fichas, com critérios definidos e fontes indicadas.</p></div>' +
            '<div><h3>Por que isso importa</h3><p>Permite entender como a Justiça responde a esses conflitos em Rondônia.</p></div>' +
          '</div>' +
        '</section>' +

        '<section class="secao"><div class="secao-cabeca"><h2>Da origem do processo ao local do conflito</h2><a href="#/temas">Conflitos e territórios</a></div>' + blocoMapas(false) + '</section>' +

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

    ligarMapa();
  }

  // Decisões judiciais: consulta com filtros
  function telaDecisoes(qs) {
    var estado = { q: qs.get('q') || '', eixo: qs.get('eixo') || '', municipio: qs.get('municipio') || '', classe: qs.get('classe') || '', orgaos: qs.getAll('orgao'), resultados: qs.getAll('resultado') };
    var orgaos = contar(D.fichas, function (f) { return f.orgao; });
    var resultados = contar(D.fichas, function (f) { return f.resultado; });
    var classes = contar(D.fichas, function (f) { return f.classe; });
    var municipios = contar(D.fichas, function (f) { return f.municipio ? f.municipio.nome + '|' + f.municipio.id : null; });

    function opcoes(lista, atual, rotTodos) {
      return '<option value="">' + rotTodos + '</option>' + lista.map(function (o) {
        return '<option value="' + esc(o.v) + '"' + (o.v === atual ? ' selected' : '') + '>' + esc(o.rot) + '</option>';
      }).join('');
    }
    function caixas(nome, lista, marcados) {
      return lista.map(function (o, i) {
        var id = nome + '-' + i;
        return '<div class="opcao"><input type="checkbox" id="' + id + '" name="' + nome + '" value="' + esc(o.rot) + '"' + (marcados.indexOf(o.rot) > -1 ? ' checked' : '') + '><label for="' + id + '">' + esc(o.rot) + ' (' + o.n + ')</label></div>';
      }).join('');
    }

    main.innerHTML =
      faixa('Decisões analisadas', 'Acervo inicial de fichas sobre acórdãos do TJRO. Cada ficha indica suas fontes e o estágio de conferência.') +
      '<div class="miolo"><div class="consulta">' +
        '<form class="filtros" id="filtros" aria-label="Filtros">' +
          '<div><label for="f-q">Buscar</label><input id="f-q" type="search" name="q" value="' + esc(estado.q) + '" placeholder="Palavra, processo, local"></div>' +
          '<div><label for="f-eixo">Eixo temático</label><select id="f-eixo" name="eixo">' + opcoes(D.eixos.map(function (e) { return { v: e.id, rot: e.curto }; }), estado.eixo, 'Todos os eixos') + '</select></div>' +
          '<div><label for="f-mun">Município</label><select id="f-mun" name="municipio">' + opcoes(municipios.map(function (m) { var p = m.rot.split('|'); return { v: p[1], rot: p[0] }; }), estado.municipio, 'Todos os municípios') + '</select></div>' +
          '<div><label for="f-classe">Classe processual</label><select id="f-classe" name="classe">' + opcoes(classes.map(function (c) { return { v: c.rot, rot: c.rot }; }), estado.classe, 'Todas as classes') + '</select></div>' +
          '<fieldset><legend>Órgão julgador</legend>' + caixas('orgao', orgaos, estado.orgaos) + '</fieldset>' +
          '<fieldset><legend>Resultado</legend>' + caixas('resultado', resultados, estado.resultados) + '</fieldset>' +
          '<button type="button" class="limpar" id="limpar">Limpar filtros</button>' +
        '</form>' +
        '<div><p class="contagem" id="contagem" aria-live="polite"></p><ul class="lista-decisoes" id="resultados"></ul></div>' +
      '</div></div>';

    var form = document.getElementById('filtros');
    function ler() {
      estado.q = form.q.value.trim();
      estado.eixo = form.eixo.value;
      estado.municipio = form.municipio.value;
      estado.classe = form.classe.value;
      estado.orgaos = [].map.call(form.querySelectorAll('input[name="orgao"]:checked'), function (i) { return i.value; });
      estado.resultados = [].map.call(form.querySelectorAll('input[name="resultado"]:checked'), function (i) { return i.value; });
    }
    function atualizar() {
      var termo = normal(estado.q);
      var lista = D.fichas.filter(function (f) {
        if (estado.eixo && f.eixos.indexOf(estado.eixo) < 0) return false;
        if (estado.municipio && (!f.municipio || f.municipio.id !== estado.municipio)) return false;
        if (estado.classe && f.classe !== estado.classe) return false;
        if (estado.orgaos.length && estado.orgaos.indexOf(f.orgao) < 0) return false;
        if (estado.resultados.length && estado.resultados.indexOf(f.resultado) < 0) return false;
        if (termo) {
          var alvo = [f.titulo, f.processo, f.partes, f.territorio, f.subtema, f.classe, f.orgao, f.relatoria, f.municipio && f.municipio.nome, f.sintese.t]
            .concat(f.normas, f.direitos, f.fundamentos.map(function (x) { return x.t; }), f.eixos.map(function (e) { return eixo(e).nome; })).join(' ');
          if (normal(alvo).indexOf(termo) < 0) return false;
        }
        return true;
      }).sort(porData);

      document.getElementById('contagem').textContent = lista.length === D.fichas.length
        ? plural(lista.length, 'decisão no acervo.', 'decisões no acervo.')
        : plural(lista.length, 'decisão encontrada', 'decisões encontradas') + ' de ' + D.fichas.length + '.';
      document.getElementById('resultados').innerHTML = lista.length ? lista.map(itemDecisao).join('')
        : '<li class="vazio">Nenhuma decisão encontrada. Tente outro filtro.</li>';

      var p = new URLSearchParams();
      ['q', 'eixo', 'municipio', 'classe'].forEach(function (k) { if (estado[k]) p.set(k, estado[k]); });
      estado.orgaos.forEach(function (o) { p.append('orgao', o); });
      estado.resultados.forEach(function (r) { p.append('resultado', r); });
      var novo = '#/decisoes' + (p.toString() ? '?' + p.toString() : '');
      if (location.hash !== novo) history.replaceState(null, '', novo);
    }
    form.addEventListener('input', function () { ler(); atualizar(); });
    form.addEventListener('change', function () { ler(); atualizar(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    document.getElementById('limpar').addEventListener('click', function () {
      [].forEach.call(form.querySelectorAll('select'), function (s) { s.value = ''; });
      [].forEach.call(form.querySelectorAll('input'), function (i) { if (i.type === 'checkbox') i.checked = false; else i.value = ''; });
      ler(); atualizar();
    });
    atualizar();
  }

  // Andamento oficial no DataJud
  function htmlAndamento(registros, completo) {
    if (!registros || !registros.length) return '<p class="carregando">Processo não encontrado na API Pública do DataJud.</p>';
    return registros.map(function (r) {
      var marcos = r.movimentos.filter(function (m) { return MARCOS.test(m.nome); });
      var lista = completo ? r.movimentos : (marcos.length ? marcos : r.movimentos).slice(0, 7);
      return '<p class="grau-titulo">' + (r.grau === 'G2' ? '2º grau' : r.grau === 'G1' ? '1º grau' : esc(r.grau)) + ': ' + esc(r.classe) +
        '<span>' + esc(r.orgao) + '</span><span>' + esc(r.assuntos.join('; ')) + '</span></p>' +
        '<ul class="andamento' + (completo ? ' andamento-completo' : '') + '">' + lista.map(function (m) {
          return '<li><time>' + esc(fmt(m.data)) + '</time><span class="' + (MARCOS.test(m.nome) ? 'marco' : '') + '">' + esc(m.nome) + (m.complemento ? ' (' + esc(m.complemento) + ')' : '') + '</span></li>';
        }).join('') + '</ul>';
    }).join('') + '<p class="nota" style="margin-top:10px">Fonte: API Pública do DataJud (CNJ). Última atualização do registro: ' + esc(fmt(registros[0].atualizacao)) + '.</p>';
  }

  function carregarAndamento(f) {
    var alvo = document.getElementById('andamento');
    if (!alvo) return;
    if (!f.processo) { alvo.innerHTML = '<p class="carregando">A fonte não divulgou o número do processo; por isso não há consulta ao DataJud.</p>'; return; }
    var copia = DJ.processos && DJ.processos[f.processo];
    if (copia) alvo.innerHTML = htmlAndamento(copia);
    if (!AO_VIVO) { if (!copia) alvo.innerHTML = semDataJud(); return; }
    fetch('/api/v1/processos/' + encodeURIComponent(f.processo)).then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (dados) { var el = document.getElementById('andamento'); if (el) el.innerHTML = htmlAndamento(dados.registros); })
      .catch(function () { var el = document.getElementById('andamento'); if (el && !copia) el.innerHTML = '<p class="carregando">DataJud indisponível agora. Tente mais tarde.</p>'; });
  }

  function telaFicha(id) {
    var f = ficha(id);
    if (!f) return telaNaoEncontrada();
    var t = f.monitoramento.tendencia ? tendencia(f.monitoramento.tendencia) : null;

    function dd(rotulo, valor, numero) {
      if (!valor) return '<dt>' + rotulo + '</dt><dd class="ausente">Não informado na fonte</dd>';
      return '<dt>' + rotulo + '</dt><dd' + (numero ? ' class="num"' : '') + '>' + esc(valor) + '</dd>';
    }
    function dim(nome, a) {
      return '<div class="dimensao"><span class="dimensao-nome">' + nome + '</span>' + (a ? afirmacao(a) : '<span class="dimensao-vazia">Sem indício na fonte consultada.</span>') + '</div>';
    }
    function lista(itens) { return '<ul>' + itens.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'; }

    main.innerHTML =
      faixa(esc(f.titulo), '', '<a href="#/decisoes">Decisões analisadas</a> / ' + esc(f.classe) + ' ' + esc(nomeProcesso(f)),
        '<div class="ficha-selos"><span class="selo">' + esc(f.resultado) + '</span>' +
        f.eixos.map(function (e) { return '<a class="selo" href="#/temas/' + e + '">' + esc(eixo(e).curto) + '</a>'; }).join('') + '</div>') +

      '<div class="miolo"><div class="ficha-grade">' +
      '<div>' +
        '<p class="ficha-estagio"><strong>Estágio de conferência:</strong> ' + esc(f.conferencia || ('ficha do acervo inicial, elaborada com ' + f.fontes.map(function (s) { return s.tipo.charAt(0).toLowerCase() + s.tipo.slice(1); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' e ') + (f.processo ? ' e dados processuais do DataJud' : '') + '. O inteiro teor oficial do acórdão ainda não foi conferido.')) + '</p>' +
        '<div class="legenda-natureza" aria-label="Legenda"><span><i style="background:var(--mata)"></i>Fato documentado na fonte</span><span><i style="background:var(--ardosia)"></i>Síntese editorial</span><span><i style="background:var(--barranco)"></i>Inferência da pesquisa</span></div>' +

        '<section class="grupo"><h2>Conflito</h2>' +
          '<h3>Local</h3><p>' + esc(f.territorio) + (f.municipio ? ', ' + esc(f.municipio.nome) : '') + '</p>' +
          '<h3>Subtema</h3><p>' + esc(f.subtema) + '</p>' +
          '<h3>Síntese dos fatos</h3>' + afirmacao(f.sintese) +
          '<h3>Atores</h3>' + lista(f.atores) +
          '<h3>Grupos atingidos</h3>' + lista(f.grupos) +
        '</section>' +

        '<section class="grupo"><h2>Aspectos jurídicos</h2>' +
          '<h3>Partes</h3><p>' + esc(f.partes) + '</p>' +
          '<h3>Pedido</h3>' + afirmacao(f.pedidos) +
          '<h3>Direitos em discussão</h3>' + lista(f.direitos) +
          '<h3>Fundamentos da decisão</h3>' + f.fundamentos.map(afirmacao).join('') +
          '<h3>Fundamentos normativos</h3><ul class="etiquetas">' + f.normas.map(function (n) { return '<li class="selo selo-eixo">' + esc(n) + '</li>'; }).join('') + '</ul>' +
          (f.precedentes.length ? '<h3>Precedentes invocados</h3>' + f.precedentes.map(afirmacao).join('') : '') +
          '<h3>Resultado</h3><p><strong>' + esc(f.resultado) + '.</strong> ' + esc(f.dispositivo) + '</p>' +
          '<h3>Providências determinadas</h3>' + lista(f.providencias) +
        '</section>' +

        '<section class="grupo"><h2>Justiça socioambiental</h2>' +
          '<p class="nota">Leitura da pesquisa sobre a decisão.</p>' +
          '<div class="dimensoes">' + dim('Distributiva', f.justica.distribuicao) + dim('Reconhecimento', f.justica.reconhecimento) + dim('Participação', f.justica.participacao) + '</div>' +
        '</section>' +

        '<section class="grupo"><h2>Monitoramento</h2>' + afirmacao(f.monitoramento) +
          (t ? '<p style="margin-top:10px">Tendência relacionada: <a href="#/radar/tendencias">' + esc(t.titulo) + '</a> (' + esc(grau(t.grau).nome.toLowerCase()) + ').</p>' : '') +
        '</section>' +

        '<section class="grupo"><h2>Fontes e rastreabilidade</h2>' +
          (f.trecho ? '<h3>Trecho citado na fonte</h3><blockquote class="trecho">"' + esc(f.trecho) + '"<cite>' + esc(f.fontes[0].veiculo) + ', ' + esc(f.fontes[0].data) + '</cite></blockquote>' : '') +
          '<h3>Fontes</h3><ul class="fontes-lista">' + f.fontes.map(function (s) {
            return '<li>' + esc(s.tipo) + ': <a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.veiculo) + '</a>, ' + esc(s.data) + '</li>';
          }).join('') + (f.processo ? '<li>Dados processuais: API Pública do DataJud, Conselho Nacional de Justiça</li>' : '') + '</ul>' +
          '<p class="nota" style="margin-top:12px">Ficha registrada no Observatório em ' + D.atualizadoEm + '. Correções são registradas nesta seção.</p>' +
        '</section>' +
      '</div>' +

      '<aside class="ficha-lado">' +
        '<section class="quadro" aria-label="Identificação"><h2>Identificação</h2><dl class="dados">' +
          dd('Processo', f.processo, true) +
          (f.processosConexos ? dd('Julgado com', f.processosConexos.join(', '), true) : '') +
          dd('Classe', f.classe) + dd('Órgão julgador', f.orgao) + dd('Relatoria', f.relatoria) +
          dd(f.tipoData, fmt(f.dataReferencia)) + dd('Origem', f.origem) +
          dd('Local', f.municipio ? f.municipio.nome : f.territorio) +
        '</dl>' + (f.processo ? '<a class="botao" href="#/processos/' + f.processo + '">Ver processo, andamento e publicações</a>' : '') +
        '<a class="botao botao-claro" href="' + CONSULTA_TJRO + '" target="_blank" rel="noopener">Jurisprudência do TJRO</a></section>' +
        '<section class="quadro"><h2>Andamento no DataJud</h2><div id="andamento">' + carregandoHtml('Consultando o DataJud') + '</div></section>' +
      '</aside>' +
      '</div></div>';

    carregarAndamento(f);
  }

  // Processos ambientais do TJRO (lista completa do DataJud)
  function itemProcesso(p) {
    var ficha = fichaDoProcesso(p.n);
    return '<li class="processo"><a class="processo-link" href="#/processos/' + p.n + '">' +
      '<span><span class="processo-num">' + esc(p.n) + '</span>' + (ficha ? '<span class="selo selo-ficha">Ficha analítica</span>' : '') +
      '<span class="processo-meta">' + esc([p.c, p.o, p.co ? 'origem ' + p.co : null].filter(Boolean).join(', ')) + '</span>' +
      '<span class="processo-assuntos">' + esc(p.a.join('; ')) + '</span></span>' +
      '<span class="processo-lado">' + (p.j ? '<span class="julgado">' + esc(rotRes(p.j[1])) + '</span><time>julgado em ' + esc(fmt(p.j[0])) + '</time>' : '<span>Sem julgamento registrado</span>') +
      (p.u ? '<time>última movimentação ' + esc(fmt(p.u[0])) + '</time>' : '') + '</span></a></li>';
  }

  function telaProcessos(qs) {
    var estado = {
      q: qs.get('q') || '', esfera: qs.get('esfera') || 'civel', classe: qs.get('classe') || '', assunto: qs.get('assunto') || '',
      comarca: qs.get('comarca') || '', ano: qs.get('ano') || '', situacao: qs.get('situacao') || '', resultado: qs.get('resultado') || '', ordem: qs.get('ordem') || 'recentes'
    };
    var mostrar = 30;
    var P = DJ.panorama;

    main.innerHTML =
      faixa('Processos do 2º grau com assunto ambiental', 'Registros do TJRO identificados no DataJud. A presença de assunto ambiental no cadastro não significa que o processo integra o acervo analisado pela pesquisa.' + (P ? '<span class="faixa-fonte">Fonte: API Pública do DataJud (CNJ). Atualizado em ' + fmtMomento(P.extraidoEm) + '.</span>' : '')) +
      '<div class="miolo"><div class="consulta"><form class="filtros" id="filtros-proc" aria-label="Filtros">' + carregandoHtml('Preparando os filtros') + '</form>' +
      '<div id="lista-proc">' + carregandoHtml('Carregando os processos do DataJud') + '</div></div></div>';

    carregarProcessos().then(function (dados) {
      var todos = dados.processos;
      var form = document.getElementById('filtros-proc');
      if (!form) return;
      function base() { return todos.filter(function (p) { return estado.esfera === 'todas' || (estado.esfera === 'criminal' ? p.cr : !p.cr); }); }
      function opcoes(lista, atual, rot) {
        return '<option value="">' + rot + '</option>' + lista.map(function (o) { return '<option value="' + esc(o.rot) + '"' + (o.rot === atual ? ' selected' : '') + '>' + esc(o.rot) + ' (' + milhar(o.n) + ')</option>'; }).join('');
      }
      function montarFiltros() {
        var b = base();
        form.innerHTML =
          '<div><label for="p-q">Buscar</label><input id="p-q" type="search" name="q" value="' + esc(estado.q) + '" placeholder="Número, assunto, comarca, gabinete"></div>' +
          '<fieldset><legend>Área</legend>' + [['civel', 'Cível'], ['criminal', 'Criminal'], ['todas', 'Todas']].map(function (e) {
            return '<div class="opcao"><input type="radio" name="esfera" id="es-' + e[0] + '" value="' + e[0] + '"' + (estado.esfera === e[0] ? ' checked' : '') + '><label for="es-' + e[0] + '">' + e[1] + '</label></div>';
          }).join('') + '</fieldset>' +
          '<div><label for="p-sit">Situação</label><select id="p-sit" name="situacao"><option value="">Todas</option><option value="julgado"' + (estado.situacao === 'julgado' ? ' selected' : '') + '>Com julgamento registrado</option><option value="sem-julgamento"' + (estado.situacao === 'sem-julgamento' ? ' selected' : '') + '>Sem julgamento registrado</option></select></div>' +
          '<div><label for="p-res">Resultado do último julgamento</label><select id="p-res" name="resultado"><option value="">Todos os resultados</option>' + contar(b, function (p) { return p.j && p.j[1]; }).map(function (o) { return '<option value="' + esc(o.rot) + '"' + (o.rot === estado.resultado ? ' selected' : '') + '>' + esc(rotRes(o.rot)) + ' (' + milhar(o.n) + ')</option>'; }).join('') + '</select></div>' +
          '<div><label for="p-ass">Assunto</label><select id="p-ass" name="assunto">' + opcoes(contar(b, function (p) { return p.a; }).slice(0, 40), estado.assunto, 'Todos os assuntos') + '</select></div>' +
          '<div><label for="p-com">Comarca de origem</label><select id="p-com" name="comarca">' + opcoes(contar(b, function (p) { return p.co; }), estado.comarca, 'Todas as comarcas') + '</select></div>' +
          '<div><label for="p-cla">Classe</label><select id="p-cla" name="classe">' + opcoes(contar(b, function (p) { return p.c; }), estado.classe, 'Todas as classes') + '</select></div>' +
          '<div><label for="p-ano">Chegada ao 2º grau</label><select id="p-ano" name="ano">' + opcoes(contar(b, function (p) { return p.aj && p.aj.slice(0, 4); }).sort(function (x, y) { return y.rot.localeCompare(x.rot); }), estado.ano, 'Todos os anos') + '</select></div>' +
          '<div><label for="p-ord">Ordenar por</label><select id="p-ord" name="ordem">' +
            [['recentes', 'Movimentação mais recente'], ['julgamento', 'Julgamento mais recente'], ['chegada', 'Chegada mais recente'], ['antigos', 'Chegada mais antiga']].map(function (o) { return '<option value="' + o[0] + '"' + (estado.ordem === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
          '</select></div>' +
          '<button type="button" class="limpar" id="limpar-proc">Limpar filtros</button>';
      }

      function filtrar() {
        var termo = normal(estado.q), digitos = estado.q.replace(/\D/g, '');
        var lista = base().filter(function (p) {
          if (estado.classe && p.c !== estado.classe) return false;
          if (estado.assunto && p.a.indexOf(estado.assunto) < 0) return false;
          if (estado.comarca && p.co !== estado.comarca) return false;
          if (estado.ano && !(p.aj && p.aj.indexOf(estado.ano) === 0)) return false;
          if (estado.situacao === 'julgado' && !p.j) return false;
          if (estado.situacao === 'sem-julgamento' && p.j) return false;
          if (estado.resultado && !(p.j && p.j[1] === estado.resultado)) return false;
          if (termo) {
            var porNumero = digitos.length >= 7 && p.n.replace(/\D/g, '').indexOf(digitos) > -1;
            if (!porNumero && normal([p.c, p.o, p.co, p.a.join(' ')].join(' ')).indexOf(termo) < 0) return false;
          }
          return true;
        });
        var chave = { recentes: function (p) { return p.u ? p.u[0] : ''; }, julgamento: function (p) { return p.j ? p.j[0] : ''; }, chegada: function (p) { return p.aj || ''; }, antigos: function (p) { return p.aj || ''; } }[estado.ordem];
        lista.sort(function (a, b) { return estado.ordem === 'antigos' ? chave(a).localeCompare(chave(b)) : chave(b).localeCompare(chave(a)); });
        return lista;
      }

      function desenhar() {
        var lista = filtrar();
        var julgados = lista.filter(function (p) { return p.j; });
        var todosRes = contar(julgados, function (p) { return p.j[1]; });
        var resultados = todosRes.slice(0, 6), outros = todosRes.slice(6);
        var nOutros = outros.reduce(function (s, o) { return s + o.n; }, 0);
        document.getElementById('lista-proc').innerHTML =
          '<div class="resumo-filtro" aria-live="polite"><span><b>' + milhar(lista.length) + '</b> ' + (lista.length === 1 ? 'processo' : 'processos') + ' com assunto ambiental</span><span><b>' + milhar(julgados.length) + '</b> com julgamento registrado no DataJud</span></div>' +
          (resultados.length ? '<p class="resultados-titulo">Resultado do último julgamento registrado em cada processo</p>' : '') +
          (resultados.length ? '<div class="resultados-mini" aria-label="Resultados dos julgamentos">' + resultados.map(function (r) {
            return '<button type="button" data-resultado="' + esc(r.rot) + '" aria-pressed="' + (estado.resultado === r.rot) + '">' + esc(rotRes(r.rot)) + ': ' + milhar(r.n) + ' (' + Math.round(r.n / julgados.length * 100) + '%)</button>';
          }).join('') + (nOutros ? '<span class="resultado-outros" title="' + esc(outros.map(function (o) { return rotRes(o.rot) + ': ' + o.n; }).join('; ')) + '">Outros resultados (' + outros.length + ' categorias): ' + milhar(nOutros) + '</span>' : '') + '</div>' : '') +
          (lista.length ? '<ul class="processos">' + lista.slice(0, mostrar).map(itemProcesso).join('') + '</ul>' : '<p class="vazio">Nenhum processo encontrado. Tente outro filtro.</p>') +
          '<div class="mais">' + (lista.length > mostrar ? '<button type="button" class="botao" id="mostrar-mais">Mostrar mais ' + Math.min(30, lista.length - mostrar) + ' de ' + milhar(lista.length - mostrar) + '</button>' : '') +
          (lista.length ? '<button type="button" class="botao botao-claro" id="baixar-csv">Baixar planilha (CSV)</button>' : '') +
          '<span class="nota">Fonte: API Pública do DataJud (CNJ).</span></div>';

        var mais = document.getElementById('mostrar-mais');
        if (mais) mais.addEventListener('click', function () { mostrar += 30; desenhar(); });
        var csv = document.getElementById('baixar-csv');
        if (csv) csv.addEventListener('click', function () { baixarCsv(lista); });
        [].forEach.call(document.querySelectorAll('.resultados-mini button'), function (b) {
          b.addEventListener('click', function () {
            estado.resultado = estado.resultado === b.getAttribute('data-resultado') ? '' : b.getAttribute('data-resultado');
            estado.situacao = estado.resultado ? 'julgado' : estado.situacao;
            mostrar = 30; montarFiltros(); desenhar();
          });
        });

        var p = new URLSearchParams();
        Object.keys(estado).forEach(function (k) { if (estado[k] && !(k === 'esfera' && estado[k] === 'civel') && !(k === 'ordem' && estado[k] === 'recentes')) p.set(k, estado[k]); });
        var novo = '#/processos' + (p.toString() ? '?' + p.toString() : '');
        if (location.hash !== novo) history.replaceState(null, '', novo);
      }

      function ler() {
        var esferaAntes = estado.esfera;
        estado.q = form.q.value.trim();
        estado.esfera = (form.querySelector('input[name="esfera"]:checked') || {}).value || 'civel';
        ['situacao', 'resultado', 'assunto', 'comarca', 'classe', 'ano', 'ordem'].forEach(function (k) { estado[k] = form[k].value; });
        mostrar = 30;
        if (esferaAntes !== estado.esfera) { ['resultado', 'assunto', 'comarca', 'classe', 'ano'].forEach(function (k) { estado[k] = ''; }); montarFiltros(); }
      }

      montarFiltros();
      form.addEventListener('input', function (e) { if (e.target.name === 'q') { ler(); desenhar(); } });
      form.addEventListener('change', function () { ler(); desenhar(); });
      form.addEventListener('submit', function (e) { e.preventDefault(); });
      form.addEventListener('click', function (e) {
        if (e.target.id !== 'limpar-proc') return;
        estado = { q: '', esfera: 'civel', classe: '', assunto: '', comarca: '', ano: '', situacao: '', resultado: '', ordem: 'recentes' };
        mostrar = 30; montarFiltros(); desenhar();
      });
      desenhar();
    }).catch(function () {
      var el = document.getElementById('lista-proc');
      if (el) el.innerHTML = semDataJud();
      var f = document.getElementById('filtros-proc');
      if (f) f.innerHTML = '';
    });
  }

  function baixarCsv(lista) {
    var linhas = [['numero', 'classe', 'gabinete', 'comarca_origem', 'assuntos', 'chegada_2o_grau', 'ultima_movimentacao', 'data_ultima_movimentacao', 'ultimo_julgamento', 'data_julgamento']];
    lista.forEach(function (p) {
      linhas.push([p.n, p.c, p.o, p.co, p.a.join(' | '), p.aj || '', p.u ? p.u[1] : '', p.u ? p.u[0] : '', p.j ? p.j[1] : '', p.j ? p.j[0] : '']);
    });
    var texto = '﻿' + linhas.map(function (l) { return l.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    var url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url; a.download = 'ojsa-processos-ambientais-tjro.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // Triagem da pesquisa: se o acórdão do processo entra na análise qualitativa (assets/triagem.js)
  function htmlTriagem(numero) {
    var T = window.OJSA_TRIAGEM;
    var t = T && T.processos[numero];
    if (!t) {
      return '<section class="triagem triagem-pendente"><p class="rotulo-bloco">Anotação da pesquisa</p><h2>Triagem da pesquisa</h2>' +
        '<p>Este processo ainda não passou pela triagem da pesquisa.</p></section>';
    }
    var rotulo = { elegivel: 'Potencialmente elegível', preselecionado: 'Potencialmente elegível', incluido: 'Incluído no acervo analisado', excluido: 'Excluído', duvida: 'Em dúvida' }[t.resultado];
    function item(r, v) { return '<dt>' + r + '</dt><dd>' + esc(v) + '</dd>'; }
    return '<section class="triagem"><p class="rotulo-bloco">Anotação da pesquisa</p><div class="triagem-topo"><h2>Triagem da pesquisa</h2><span class="triagem-resultado triagem-' + t.resultado + '">' + rotulo + '</span></div>' +
      '<dl class="triagem-itens">' + item('Tema preliminar', t.grupo) + item('Documento lido', t.documento) +
      item('Elemento ambiental', t.ambiental) + item('Elemento social', t.social) + item('Por que foi selecionado para triagem', t.motivo) + item('Situação da análise', t.situacao) + '</dl>' +
      '<p class="nota">Triagem de ' + esc(t.data) + '.</p></section>';
  }

  // Página de um processo: dados do DataJud, andamento completo e publicações oficiais
  function telaProcesso(numeroRota) {
    var numero = formatarNumero(numeroRota);
    var ficha = fichaDoProcesso(numero);
    main.innerHTML =
      faixa('Processo ' + esc(numero), 'Dados do DataJud e do Diário de Justiça Eletrônico Nacional (CNJ).', '<a href="#/processos">Processos judiciais</a> / ' + esc(numero)) +
      '<div class="miolo"><div class="ficha-grade"><div>' +
        (ficha ? '<div class="ressalva" style="margin-bottom:20px"><strong>Este processo tem ficha analítica.</strong> <a href="#/decisoes/' + ficha.id + '">' + esc(ficha.titulo) + '</a></div>' : '') +
        htmlTriagem(numero) +
        '<section class="grupo bloco-publicacoes"><p class="rotulo-bloco">Publicações oficiais</p><h2>Atos publicados no Diário de Justiça</h2>' +
          '<p class="nota">Publicações deste processo no Diário de Justiça Eletrônico Nacional. Cada item é um ato publicado, não o inteiro teor de uma decisão analisada pela pesquisa. Quando o tribunal disponibiliza, há link para o documento no PJe.</p>' +
          '<div id="publicacoes">' + carregandoHtml('Consultando o Diário de Justiça Eletrônico Nacional') + '</div></section>' +
        '<section class="grupo"><p class="rotulo-bloco">Dados do processo</p><h2>Andamento no DataJud</h2><div id="andamento-completo">' + carregandoHtml('Consultando o DataJud, que pode levar até 30 segundos') + '</div></section>' +
      '</div>' +
      '<aside class="ficha-lado"><section class="quadro"><p class="rotulo-bloco">Dados do processo</p><h2>Identificação no DataJud</h2><div id="ident-proc">' + carregandoHtml('Carregando') + '</div>' +
        '<button type="button" class="botao" id="copiar-num">Copiar número do processo</button>' +
        '<a class="botao botao-claro" href="https://pjesg.tjro.jus.br/consulta/ConsultaPublica/listView.seam" target="_blank" rel="noopener">Consulta pública PJe 2º grau</a>' +
        '<a class="botao botao-claro" href="https://pjepg.tjro.jus.br/consulta/ConsultaPublica/listView.seam" target="_blank" rel="noopener">Consulta pública PJe 1º grau</a>' +
        '<p class="nota" style="margin-top:10px">Na consulta pública do PJe, cole o número copiado.</p></section></aside>' +
      '</div></div>';

    document.getElementById('copiar-num').addEventListener('click', function () {
      var b = this;
      function ok() { b.textContent = 'Número copiado'; setTimeout(function () { b.textContent = 'Copiar número do processo'; }, 2000); }
      if (navigator.clipboard) navigator.clipboard.writeText(numero).then(ok, function () { b.textContent = numero; });
      else b.textContent = numero;
    });

    carregarProcessos().then(function (dados) {
      var el = document.getElementById('ident-proc');
      if (!el) return;
      var p = dados.processos.filter(function (x) { return x.n === numero; })[0];
      function linha(r, v) { return v ? '<dt>' + r + '</dt><dd>' + esc(v) + '</dd>' : ''; }
      el.innerHTML = p ? '<dl class="dados">' + linha('Classe', p.c) + linha(/vara|juizado/i.test(p.o || '') ? 'Unidade de origem (informada no DataJud)' : 'Gabinete no 2º grau', p.o) + linha('Comarca de origem', p.co) + linha('Assuntos', p.a.join('; ')) +
        linha('Chegada ao 2º grau', fmt(p.aj)) + linha('Último julgamento registrado', p.j ? rotRes(p.j[1]) + ', ' + fmt(p.j[0]) : 'Sem julgamento registrado') + linha('Última movimentação', p.u ? p.u[1] + ', ' + fmt(p.u[0]) : null) + '</dl>'
        : '<p class="nota">Fora do recorte ambiental. Dados direto do DataJud.</p>';
    }).catch(function () { var el = document.getElementById('ident-proc'); if (el) el.innerHTML = ''; });

    // o Diário de Justiça Nacional aceita consulta direta do navegador; a API do Observatório fica de reserva
    var digitos = numero.replace(/\D/g, '');
    fetch('https://comunicaapi.pje.jus.br/api/v1/comunicacao?siglaTribunal=TJRO&numeroProcesso=' + digitos)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (j) {
        return { publicacoes: (j.items || []).map(function (i) {
          return { data: i.data_disponibilizacao, tipo: i.tipoComunicacao, documento: i.tipoDocumento, orgao: i.nomeOrgao, link: i.link || null, texto: String(i.texto || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim() };
        }).sort(function (a, b) { return (b.data || '').localeCompare(a.data || ''); }) };
      })
      .catch(function () { return fetch('/api/v1/publicacoes/' + encodeURIComponent(numero)).then(function (r) { return r.ok ? r.json() : Promise.reject(); }); })
      .then(function (j) {
      var el = document.getElementById('publicacoes');
      if (!el) return;
      el.innerHTML = j.publicacoes.length ? j.publicacoes.map(function (pub) {
        return '<article class="publicacao"><div class="publicacao-topo"><strong>' + esc(pub.documento || pub.tipo) + '</strong><span class="nota">' + esc(fmt(pub.data)) + '</span></div>' +
          '<span class="nota">' + esc(pub.orgao) + (pub.tipo && pub.tipo !== pub.documento ? ', ' + esc(pub.tipo) : '') + '</span>' +
          (pub.link ? '<p style="margin:4px 0 0"><a href="' + esc(pub.link) + '" target="_blank" rel="noopener">Abrir o documento no PJe</a></p>' : '') +
          (pub.texto ? '<details><summary>Ler o texto publicado</summary><div class="texto-oficial">' + esc(pub.texto) + '</div></details>' : '') + '</article>';
      }).join('') + '<p class="nota" style="margin-top:10px">Fonte: Diário de Justiça Eletrônico Nacional (CNJ).</p>'
        : '<p class="nota">Sem publicações no Diário de Justiça Eletrônico Nacional. Atos antigos estão no site do TJRO.</p>';
    }).catch(function () { var el = document.getElementById('publicacoes'); if (el) el.innerHTML = '<p class="nota">Diário de Justiça indisponível agora. Tente mais tarde.</p>'; });

    fetch('/api/v1/processos/' + encodeURIComponent(numero)).then(function (r) { return r.ok ? r.json() : Promise.reject(); }).then(function (j) {
      var el = document.getElementById('andamento-completo');
      if (el) el.innerHTML = htmlAndamento(j.registros, true);
    }).catch(function () { var el = document.getElementById('andamento-completo'); if (el) el.innerHTML = '<p class="nota">DataJud indisponível agora. Tente mais tarde.</p>'; });
  }

  // Radar Jurisprudencial
  function htmlTramitacao(qtd) {
    var P = DJ.panorama;
    if (!P || !P.recentes) return semDataJud();
    return '<ul class="tramitacao">' + P.recentes.slice(0, qtd || 15).map(function (p) {
      var ult = p.movimentos[0];
      var origem = comarcaDe(p.numero);
      return '<li><div><a class="num" href="#/processos/' + esc(p.numero) + '">' + esc(p.numero) + '</a>' +
        '<span class="meta">' + esc(p.classe) + ', ' + esc(p.orgao) + (origem ? ', origem ' + esc(origem) : '') + '</span>' +
        '<span class="meta">' + esc(p.assuntos.join('; ')) + '</span></div>' +
        '<div class="mov">' + (ult ? esc(ult.nome) + '<time>' + esc(fmt(ult.data)) + '</time>' : '') + '</div></li>';
    }).join('') + '</ul><p class="nota" style="margin-top:10px">Fonte: API Pública do DataJud (CNJ), extração de ' + fmtMomento(P.extraidoEm) + '.</p>';
  }

  function telaRadar() {
    var novas = D.fichas.slice().sort(porData);
    var secoes = [['novas', 'Novas decisões'], ['tendencias', 'Tendências em análise'], ['metodo', 'Como identificamos uma tendência'], ['divergencias', 'Entendimentos e divergências'], ['precedentes', 'Precedentes relevantes'], ['tramitacao', 'Processos em tramitação'], ['boletins', 'Boletins']];

    main.innerHTML =
      faixa('Radar Jurisprudencial', 'Monitoramento e tendências jurisprudenciais: o que foi decidido está na ficha de cada acórdão; aqui ficam os padrões em observação.') +
      '<div class="miolo"><div class="radar-grade">' +
        '<ul class="radar-indice nao-imprimir">' + secoes.map(function (s) { return '<li><a href="#/radar/' + s[0] + '">' + s[1] + '</a></li>'; }).join('') + '</ul>' +
        '<div>' +
          '<section class="modulo" id="novas"><h2>Novas decisões</h2><p class="modulo-desc">Acórdãos do acervo, do mais recente para o mais antigo, com a data usada como referência.</p>' +
            '<ul class="lista-decisoes">' + novas.map(itemDecisao).join('') + '</ul></section>' +

          '<section class="modulo" id="tendencias"><h2>Tendências em análise</h2><p class="modulo-desc">Cada tendência informa amostra, órgãos e período, e recebe um grau de evidência. Nenhum tema chegou a entendimento sustentado.</p>' +
            '<div class="escala">' + D.graus.map(function (g) { return '<div class="escala-passo grau-' + g.id + '"><strong>' + medidor(g.id) + esc(g.nome) + '</strong>' + esc(g.def) + '</div>'; }).join('') + '</div>' +
            D.tendencias.map(function (t) {
              return '<article class="tendencia grau-' + t.grau + '"><div class="tendencia-topo"><h3>' + esc(t.titulo) + '</h3><span class="tendencia-grau grau-' + t.grau + '">' + medidor(t.grau) + esc(grau(t.grau).nome) + '</span></div>' +
                '<div class="tendencia-fatos"><span><b>Amostra:</b> ' + plural(t.fichas.length, 'ficha', 'fichas') + '</span><span><b>Órgãos:</b> ' + esc(t.orgaos) + '</span><span><b>Período:</b> ' + esc(t.periodo) + '</span></div>' +
                '<p>' + esc(t.descricao) + '</p>' +
                '<p style="font-size:14px">Fichas: ' + t.fichas.map(function (id) { var f = ficha(id); return '<a href="#/decisoes/' + id + '">' + esc(f.processo || f.titulo) + '</a>'; }).join('; ') + '</p>' +
                '<div class="ressalva"><strong>Ressalvas.</strong> ' + esc(t.ressalvas) + '</div></article>';
            }).join('') +
          '</section>' +

          '<section class="modulo" id="metodo"><h2>Como identificamos uma tendência</h2><p class="modulo-desc">Os cinco passos valem para qualquer tema antes de ele aparecer no Radar.</p>' +
            '<ol class="passos">' +
              '<li><strong>Delimitar</strong>Tema, intervalo, classe processual e órgãos julgadores.</li>' +
              '<li><strong>Comparar</strong>Fundamentos, dispositivo, soluções e divergências.</li>' +
              '<li><strong>Contextualizar</strong>Quantidade de decisões, fatos particulares e mudanças normativas.</li>' +
              '<li><strong>Validar</strong>Revisão humana e fundamentação documental.</li>' +
              '<li><strong>Publicar</strong>Resumo, metodologia, amostra e links dos julgados.</li>' +
            '</ol><p class="regra"><strong>Regra de qualidade:</strong> frequência estatística não é sinônimo de orientação jurisprudencial consolidada. Toda tendência aparece com grau de evidência e ressalvas.</p>' +
          '</section>' +

          '<section class="modulo" id="divergencias"><h2>Entendimentos e divergências</h2><p class="modulo-desc">Decisões que apontam em sentidos diferentes sobre o mesmo problema, no próprio TJRO ou entre o TJRO e os tribunais superiores.</p>' +
            D.divergencias.map(function (v) {
              return '<article class="divergencia"><h3>' + esc(v.titulo) + '</h3><div class="lados">' +
                v.lados.map(function (l) { return '<div class="lado"><strong>' + esc(l.quem) + '</strong>' + esc(l.texto) + (l.ficha ? ' <a href="#/decisoes/' + l.ficha + '">Ver ficha</a>' : '') + '</div>'; }).join('') +
                '</div><p class="fontes-mini">Fontes: ' + v.fontes.map(function (s) { return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.rotulo) + '</a>'; }).join(', ') + '.</p></article>';
            }).join('') +
          '</section>' +

          '<section class="modulo" id="precedentes"><h2>Precedentes relevantes</h2><p class="modulo-desc">Ligações entre as decisões do TJRO e precedentes do STF e do STJ, indicando se o precedente foi invocado ou se a ligação é da pesquisa.</p>' +
            '<table class="tabela"><thead><tr><th>Tribunal</th><th>Precedente</th><th>Relação com o acervo</th></tr></thead><tbody>' +
            D.precedentes.map(function (p) {
              return '<tr><td class="forte">' + esc(p.tribunal) + '</td><td><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.ref) + '</a><br>' + esc(p.texto) + '</td><td>' + esc(p.relacao) +
                (p.fichas.length ? '<br>' + p.fichas.map(function (id) { return '<a href="#/decisoes/' + id + '">' + esc(ficha(id).processo) + '</a>'; }).join(', ') : '') + '</td></tr>';
            }).join('') + '</tbody></table>' +
          '</section>' +

          '<section class="modulo" id="tramitacao"><h2>Processos em tramitação</h2><p class="modulo-desc">Processos cíveis do 2º grau do TJRO com assuntos ambientais, pela movimentação mais recente registrada no DataJud. É a lista de triagem para novas fichas: os processos ainda não foram analisados.</p>' +
            '<div id="tramitacao-lista">' + htmlTramitacao() + '</div></section>' +

          '<section class="modulo" id="boletins"><h2>Boletins</h2>' +
            '<div class="boletim-chamada"><div><h3>Panorama jurisprudencial</h3><p>Revisão realizada até novembro de 2026</p></div><a class="botao" href="#/radar/boletim">Ler o boletim</a></div>' +
          '</section>' +
        '</div>' +
      '</div></div>';
  }

  function telaBoletim() {
    var novas = D.fichas.slice().sort(porData);
    var P = DJ.panorama;
    main.innerHTML =
      faixa('Panorama jurisprudencial', 'Revisão realizada até novembro de 2026.', '<a href="#/radar">Radar Jurisprudencial</a> / Boletins') +
      '<div class="miolo"><article class="boletim">' +
      '<p class="nao-imprimir"><button class="botao botao-claro" type="button" id="imprimir">Imprimir ou salvar em PDF</button></p>' +
      '<h2>Abrangência e metodologia</h2><p>Acórdãos do TJRO sobre conflitos socioambientais, localizados em notícias institucionais e bases acadêmicas e conferidos na API Pública do DataJud. São ' + plural(D.fichas.length, 'decisão', 'decisões') + ' no acervo. As fichas distinguem fatos documentados, sínteses editoriais e inferências da pesquisa.' +
        (P ? ' No mesmo período de referência, o DataJud registra ' + milhar(P.civeis) + ' processos cíveis com assunto ambiental no 2º grau do TJRO.' : '') + '</p>' +
      '<h2>Novos acórdãos</h2><ul>' + novas.map(function (f) { return '<li>' + esc(f.titulo) + ' (' + esc([f.orgao, f.processo ? 'processo ' + f.processo : null].filter(Boolean).join(', ')) + ').</li>'; }).join('') + '</ul>' +
      '<h2>Entendimentos em observação</h2><ul>' + D.tendencias.map(function (t) { return '<li>' + esc(t.titulo) + '. Grau de evidência: ' + esc(grau(t.grau).nome.toLowerCase()) + '; amostra de ' + plural(t.fichas.length, 'ficha', 'fichas') + '.</li>'; }).join('') + '</ul>' +
      '<h2>Divergências</h2>' + D.divergencias.map(function (v) { return '<p><strong>' + esc(v.titulo) + '.</strong> ' + v.lados.map(function (l) { return esc(l.quem) + ': ' + esc(l.texto); }).join(' ') + '</p>'; }).join('') +
      '<h2>Precedentes relevantes</h2><ul>' + D.precedentes.map(function (p) { return '<li>' + esc(p.tribunal) + ', ' + esc(p.ref) + '. ' + esc(p.relacao) + '</li>'; }).join('') + '</ul>' +
      '<h2>Links às decisões</h2><p>Cada ficha está em <a href="#/decisoes">Decisões analisadas</a>, com as fontes usadas, o andamento no DataJud e o caminho para a consulta oficial do TJRO.</p>' +
      '<h2>Limites da análise</h2><p>Repetição de decisões não significa jurisprudência consolidada. As fichas foram feitas a partir de notícias e bases públicas; o inteiro teor dos acórdãos não foi consultado. Nada aqui avalia se as decisões foram cumpridas.</p>' +
      '</article></div>';
    document.getElementById('imprimir').addEventListener('click', function () { window.print(); });
  }

  // Indicadores
  function telaIndicadores() {
    var F = D.fichas;
    var P = DJ.panorama;
    var anos = F.map(anoDe).filter(Boolean).sort();
    var dimensoes = [
      { rot: 'Distributiva', n: F.filter(function (f) { return f.justica.distribuicao; }).length },
      { rot: 'Reconhecimento', n: F.filter(function (f) { return f.justica.reconhecimento; }).length },
      { rot: 'Participação', n: F.filter(function (f) { return f.justica.participacao; }).length }
    ];

    var panorama = P ?
      '<div class="destaques destaques-dois">' +
        '<div><b>' + milhar(P.civeis) + '</b><span>processos cíveis com assunto ambiental (universo de busca)</span></div>' +
        (P.julgados != null ? '<div><b>' + milhar(P.julgados) + '</b><span>com julgamento registrado no DataJud</span></div>' : '') +
      '</div>' +
      '<p class="nota" style="margin:4px 0 14px">Nenhum desses números equivale a conflitos comprovados ou a acórdãos analisados pela pesquisa.</p>' +
      '<div class="recorte"><span><b>Fonte:</b> ' + esc(P.fonte) + '</span><span><b>Extração:</b> ' + fmtMomento(P.extraidoEm) + '</span><span><b>Recorte:</b> 2º grau do TJRO, processos cíveis</span><span><a href="#/indicadores/criterios">Ver critérios</a></span></div>' +
      '<div class="paineis">' +
        painel('Classe processual', '', P.porClasse.slice(0, 8)) +
        painel('Assuntos mais frequentes', 'Um processo pode ter mais de um assunto.', P.porAssunto.slice(0, 12)) +
        painel('Ano de chegada ao 2º grau', '', P.porAno) +
        painel('Comarca de origem', 'Onde o processo começou. As 15 maiores.', P.porComarca.slice(0, 15)) +
        (P.porResultado ? painel('Resultado do último julgamento', 'Último resultado registrado, entre ' + milhar(P.julgados) + ' processos julgados.', P.porResultado.slice(0, 10).map(function (x) { return { rot: rotRes(x.rot), n: x.n }; })) : '') +
      '</div>' : semDataJud();

    main.innerHTML =
      faixa('Indicadores', 'Números do TJRO e do acervo analisado.') +
      '<div class="miolo">' +
        '<section class="secao secao-processos" id="panorama"><p class="mapa-conta conta-processos">Conta processos do DataJud</p><div class="secao-cabeca"><h2>Panorama do TJRO</h2><p>Processos do 2º grau com assunto ambiental</p></div>' + panorama + '</section>' +

        '<section class="secao secao-acervo" id="acervo"><p class="mapa-conta conta-decisoes">Conta decisões analisadas pela pesquisa</p><div class="secao-cabeca"><h2>Acervo analisado</h2><p>Decisões com ficha no Observatório</p></div>' +
          '<div class="recorte"><span><b>Amostra:</b> ' + plural(F.length, 'decisão', 'decisões') + '</span><span><b>Período:</b> ' + anos[0] + ' a ' + anos[anos.length - 1] + '</span><span><b>Atualização:</b> ' + D.atualizadoEm + '</span></div>' +
          '<div class="paineis">' +
            painel('Decisões por eixo temático', 'Uma decisão pode ter mais de um eixo.', D.eixos.map(function (e) { return { rot: e.curto, n: F.filter(function (f) { return f.eixos.indexOf(e.id) > -1; }).length }; })) +
            painel('Órgão julgador', '', contar(F, function (f) { return f.orgao || 'Não informado na fonte'; })) +
            painel('Resultado', '', contar(F, function (f) { return f.resultado; })) +
            painel('Ano de referência', '', contar(F, anoDe).sort(function (a, b) { return a.rot.localeCompare(b.rot); })) +
            painel('Fundamentos normativos mais citados', '', contar(F, function (f) { return f.normas; }).slice(0, 8)) +
            painel('Dimensões de justiça socioambiental', 'Leitura da pesquisa.', dimensoes) +
          '</div>' +
        '</section>' +

        '<section class="secao texto" id="criterios"><div class="secao-cabeca"><h2>Critérios</h2></div>' +
          '<p><strong>Panorama do TJRO.</strong> ' + esc(P ? P.criterio : 'Consulta à API Pública do DataJud por assuntos ambientais da Tabela Processual Unificada.') + ' Processos criminais ficam fora do recorte. A comarca de origem vem do número do processo. Os números mudam a cada atualização.</p>' +
          '<p><strong>Acervo analisado.</strong> Uma ficha por decisão, com fontes. As dimensões de justiça são leitura da pesquisa.</p>' +
          '<p><strong>Leitura.</strong> Frequência não é jurisprudência consolidada.</p>' +
        '</section>' +
      '</div>';
  }

  // Temas e Territórios
  function telaTemas() {
    var P = DJ.panorama;
    main.innerHTML =
      faixa('Conflitos e territórios', 'Mapas dos processos e das decisões analisadas, e os eixos temáticos da pesquisa.') +
      '<div class="miolo">' +
        '<section class="secao"><div class="secao-cabeca"><h2>Da origem do processo ao local do conflito</h2></div>' + blocoMapas(true) + '</section>' +
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
  document.getElementById('sub-temas').innerHTML = '<li><a href="#/temas">Mapas: origem do processo e local do conflito</a></li>' +
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
