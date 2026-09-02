<?php
define('OPTOTICA_BOOTSTRAP', true);
require_once dirname(__DIR__) . '/optotica-core/auth.php';
optotica_require_professional_login();
header('X-Robots-Tag: noindex, nofollow, noarchive, nosnippet', true);
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0', true);
header('Pragma: no-cache', true);
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Portal Optótica · Área do Optometrista</title>

  <style>
    :root{
      --bg:#f5f5f3;
      --surface:#ffffff;
      --surface-2:#fafaf8;
      --text:#171717;
      --muted:#6e6e69;
      --line:#deded8;
      --line-strong:#c7c7bf;
      --soft:#efefea;
      --success:#1f7a4b;
      --warning:#9a6512;
      --danger:#a33a32;
      --radius:18px;
      --shadow:0 8px 28px rgba(0,0,0,.05);
    }

    *{box-sizing:border-box}

    html{scroll-behavior:smooth}

    body{
      margin:0;
      background:var(--bg);
      color:var(--text);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
      line-height:1.45;
    }

    button,input,select,textarea{font:inherit}

    .app{
      width:min(1440px,calc(100% - 28px));
      margin:20px auto 80px;
    }

    .header{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:20px;
      margin-bottom:18px;
    }

    .eyebrow{
      margin:0 0 6px;
      color:var(--muted);
      font-size:11px;
      font-weight:800;
      text-transform:uppercase;
      letter-spacing:.08em;
    }

    h1{
      margin:0;
      font-size:clamp(29px,4vw,42px);
      line-height:1.05;
      letter-spacing:-.035em;
    }

    h2{
      margin:0;
      font-size:22px;
      letter-spacing:-.02em;
    }

    h3{
      margin:0;
      font-size:16px;
    }

    .header-actions{
      display:flex;
      flex-wrap:wrap;
      gap:10px;
      justify-content:flex-end;
    }

    .pill{
      display:inline-flex;
      align-items:center;
      gap:8px;
      padding:9px 12px;
      border:1px solid var(--line);
      border-radius:999px;
      background:var(--surface);
      font-size:12px;
      font-weight:800;
      white-space:nowrap;
    }

    .dot{
      width:8px;
      height:8px;
      border-radius:50%;
      background:var(--warning);
    }

    /* STEPPER */
    .flow-wrap{
      position:sticky;
      top:0;
      z-index:20;
      background:rgba(245,245,243,.95);
      backdrop-filter:blur(12px);
      padding:8px 0 14px;
      margin-bottom:18px;
    }

    .flow{
      display:grid;
      grid-template-columns:repeat(9,minmax(118px,1fr));
      gap:8px;
      overflow-x:auto;
      padding-bottom:3px;
      scrollbar-width:thin;
    }

    .flow a{
      min-width:118px;
      text-decoration:none;
      color:inherit;
      border:1px solid var(--line);
      background:var(--surface);
      border-radius:14px;
      padding:10px 11px;
      display:grid;
      grid-template-columns:28px 1fr;
      gap:8px;
      align-items:center;
      transition:.2s ease;
    }

    .flow a:hover{
      border-color:var(--line-strong);
      transform:translateY(-1px);
    }

    .step-number{
      width:28px;
      height:28px;
      border-radius:50%;
      display:grid;
      place-items:center;
      background:var(--soft);
      color:var(--muted);
      font-size:11px;
      font-weight:900;
      flex:none;
    }

    .flow .done .step-number{
      background:var(--success);
      color:#fff;
    }

    .flow .current{
      border-color:#171717;
      box-shadow:inset 0 0 0 1px #171717;
    }

    .flow .current .step-number{
      background:#171717;
      color:#fff;
    }

    .flow strong{
      display:block;
      font-size:12px;
      line-height:1.15;
    }

    .flow small{
      display:block;
      margin-top:2px;
      color:var(--muted);
      font-size:10px;
      line-height:1.2;
    }

    /* GENERAL LAYOUT */
    .overview{
      display:grid;
      grid-template-columns:minmax(0,1fr) 360px;
      gap:18px;
      align-items:start;
      margin-bottom:18px;
    }

    .stack{display:grid;gap:18px}

    .card{
      background:var(--surface);
      border:1px solid var(--line);
      border-radius:var(--radius);
      box-shadow:var(--shadow);
      overflow:hidden;
    }

    .card-head{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:16px;
      padding:20px 20px 14px;
      border-bottom:1px solid var(--line);
    }

    .card-body{padding:20px}

    .grid{
      display:grid;
      gap:14px;
    }

    .grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}
    .grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}
    .grid-4{grid-template-columns:repeat(4,minmax(0,1fr))}

    .field{
      display:grid;
      gap:6px;
    }

    label{
      font-size:11px;
      font-weight:800;
      color:#41413d;
      letter-spacing:.02em;
    }

    input,select,textarea{
      width:100%;
      border:1px solid var(--line);
      background:#fff;
      color:var(--text);
      border-radius:11px;
      padding:11px 12px;
      outline:none;
    }

    textarea{
      min-height:88px;
      resize:vertical;
    }

    input:focus,select:focus,textarea:focus{
      border-color:#888880;
      box-shadow:0 0 0 3px rgba(0,0,0,.04);
    }

    .helper{
      color:var(--muted);
      font-size:11px;
    }

    .required::after{
      content:" *";
      color:var(--danger);
    }

    .summary-grid{
      display:grid;
      grid-template-columns:repeat(4,minmax(0,1fr));
      gap:10px;
      margin-bottom:12px;
    }

    .stat{
      padding:14px;
      border:1px solid var(--line);
      border-radius:14px;
      background:var(--surface-2);
    }

    .stat span{
      display:block;
      color:var(--muted);
      font-size:10px;
      text-transform:uppercase;
      letter-spacing:.06em;
      font-weight:800;
    }

    .stat strong{
      display:block;
      margin-top:4px;
      font-size:14px;
    }

    .progress{
      height:7px;
      border-radius:999px;
      background:var(--soft);
      overflow:hidden;
      margin-top:10px;
    }

    .progress > div{
      height:100%;
      width:28%;
      background:#171717;
    }


    .orders-strip{
      display:flex;
      align-items:center;
      gap:8px;
      overflow-x:auto;
      padding:2px 0 12px;
      margin-bottom:14px;
      scrollbar-width:thin;
    }

    .order-tab{
      flex:0 0 auto;
      display:inline-flex;
      align-items:center;
      gap:8px;
      min-height:42px;
      padding:9px 13px;
      border:1px solid var(--line);
      border-radius:12px;
      background:#fff;
      color:var(--text);
      text-decoration:none;
      font-size:12px;
      font-weight:850;
      cursor:pointer;
      transition:.2s ease;
    }

    .order-tab:hover{
      border-color:var(--line-strong);
      transform:translateY(-1px);
    }

    .order-tab.active{
      background:#171717;
      color:#fff;
      border-color:#171717;
    }

    .order-tab small{
      font-size:10px;
      font-weight:700;
      opacity:.72;
    }

    .order-add{
      width:42px;
      min-width:42px;
      height:42px;
      padding:0;
      border-radius:12px;
      border:1px dashed var(--line-strong);
      background:var(--surface-2);
      color:var(--text);
      font-size:22px;
      line-height:1;
      font-weight:500;
      cursor:pointer;
    }

    .order-add:hover{
      background:#fff;
      border-style:solid;
    }


    .order-tab .saved-state{
      opacity:.72;
      font-size:10px;
      font-weight:700;
    }

    .sidebar{
      position:sticky;
      top:112px;
    }

    .summary-row{
      display:flex;
      justify-content:space-between;
      gap:18px;
      padding:10px 0;
      border-bottom:1px solid var(--line);
      font-size:12px;
    }

    .summary-row:last-child{border-bottom:0}
    .summary-row span:first-child{color:var(--muted)}
    .summary-row strong{text-align:right}

    .notice{
      margin-top:14px;
      padding:12px;
      border:1px solid var(--line);
      border-radius:12px;
      background:var(--surface-2);
      color:#55554f;
      font-size:11px;
    }

    /* STEP SECTIONS */
    .step-section{
      scroll-margin-top:130px;
      margin-top:18px;
    }

    .step-title{
      display:flex;
      gap:12px;
      align-items:center;
    }

    .step-badge{
      width:34px;
      height:34px;
      border-radius:50%;
      display:grid;
      place-items:center;
      background:#171717;
      color:#fff;
      font-size:12px;
      font-weight:900;
      flex:none;
    }

    .complete-tag,
    .pending-tag{
      border-radius:999px;
      padding:6px 9px;
      font-size:10px;
      font-weight:900;
      white-space:nowrap;
    }

    .complete-tag{
      background:#edf7f1;
      color:var(--success);
    }

    .pending-tag{
      background:#f6f0e7;
      color:var(--warning);
    }

    .subsection{
      padding:15px;
      border:1px solid var(--line);
      border-radius:14px;
      background:var(--surface-2);
    }

    .subsection h3{margin-bottom:10px}

    .photo-box{
      min-height:180px;
      border:1px dashed var(--line-strong);
      border-radius:14px;
      display:grid;
      place-items:center;
      text-align:center;
      padding:18px;
      color:var(--muted);
      background:#fff;
    }

    .rx-table{
      width:100%;
      border-collapse:separate;
      border-spacing:0;
      border:1px solid var(--line);
      border-radius:13px;
      overflow:hidden;
    }

    .rx-table th,.rx-table td{
      padding:8px;
      border-right:1px solid var(--line);
      border-bottom:1px solid var(--line);
      text-align:center;
    }

    .rx-table th:last-child,.rx-table td:last-child{border-right:0}
    .rx-table tr:last-child td,.rx-table tr:last-child th{border-bottom:0}
    .rx-table thead th{
      background:var(--soft);
      font-size:10px;
      text-transform:uppercase;
      letter-spacing:.05em;
    }

    .rx-table tbody th{
      background:#fafaf8;
      width:56px;
      font-size:12px;
    }

    .rx-table input{
      min-width:74px;
      text-align:center;
      padding:9px 7px;
      border-radius:8px;
    }

    .os-list{
      display:grid;
      gap:10px;
    }

    .os-item{
      display:grid;
      grid-template-columns:1fr auto;
      gap:16px;
      align-items:center;
      padding:13px 14px;
      border:1px solid var(--line);
      border-radius:13px;
      background:#fff;
    }

    .os-item strong{
      display:block;
      font-size:13px;
    }

    .os-item small{
      color:var(--muted);
      display:block;
      margin-top:2px;
    }


    .budget-option{
      cursor:pointer;
      transition:.2s ease;
    }

    .budget-option:hover{
      border-color:var(--line-strong);
    }

    .selected-budget{
      border-color:#171717;
      box-shadow:inset 0 0 0 1px #171717;
      background:#fafaf8;
    }


    .empty-budget{
      padding:18px;
      border:1px dashed var(--line-strong);
      border-radius:13px;
      background:#fff;
      color:var(--muted);
      font-size:12px;
      text-align:center;
    }

    .price{
      font-size:18px;
      font-weight:900;
      letter-spacing:-.02em;
      white-space:nowrap;
    }

    .product-choice{
      display:grid;
      grid-template-columns:120px 1fr auto;
      gap:16px;
      align-items:center;
      padding:14px;
      border:1px solid var(--line);
      border-radius:14px;
      background:var(--surface-2);
    }

    .product-img{
      aspect-ratio:1.25;
      border:1px solid var(--line);
      border-radius:12px;
      display:grid;
      place-items:center;
      background:#fff;
      color:var(--muted);
      font-size:11px;
      text-align:center;
    }

    .money{
      position:relative;
    }

    .money::before{
      content:"R$";
      position:absolute;
      left:13px;
      top:50%;
      transform:translateY(-50%);
      font-weight:900;
      color:#3a3a36;
      z-index:1;
    }

    .money input{
      padding-left:40px;
      font-size:22px;
      font-weight:900;
    }

    .choice-row{
      display:flex;
      flex-wrap:wrap;
      gap:9px;
    }

    .choice{
      position:relative;
    }

    .choice input{
      position:absolute;
      opacity:0;
      pointer-events:none;
    }

    .choice span{
      display:inline-flex;
      min-height:39px;
      align-items:center;
      padding:8px 12px;
      border:1px solid var(--line);
      border-radius:11px;
      background:#fff;
      font-size:12px;
      font-weight:750;
      cursor:pointer;
    }

    .choice input:checked + span{
      border-color:#171717;
      box-shadow:inset 0 0 0 1px #171717;
    }

    .timeline{
      display:grid;
      gap:9px;
    }

    .timeline-item{
      display:grid;
      grid-template-columns:18px 1fr auto;
      gap:10px;
      align-items:start;
      padding:10px 0;
      border-bottom:1px solid var(--line);
    }

    .timeline-item:last-child{border-bottom:0}

    .timeline-icon{
      width:18px;
      height:18px;
      border-radius:50%;
      background:var(--soft);
      display:grid;
      place-items:center;
      font-size:9px;
      font-weight:900;
    }

    .timeline-item.done .timeline-icon{
      background:var(--success);
      color:#fff;
    }

    .timeline-item strong{
      display:block;
      font-size:12px;
    }

    .timeline-item small{
      color:var(--muted);
      font-size:10px;
    }

    .timeline-date{
      color:var(--muted);
      font-size:10px;
      text-align:right;
    }

    .btn{
      appearance:none;
      border:0;
      border-radius:12px;
      min-height:44px;
      padding:10px 14px;
      font-weight:850;
      cursor:pointer;
    }

    .btn-primary{
      background:#171717;
      color:#fff;
    }

    .btn-secondary{
      background:#fff;
      color:#171717;
      border:1px solid var(--line);
    }

    .btn-success{
      background:var(--success);
      color:#fff;
    }

    .actions{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      margin-top:15px;
    }

    .footer-note{
      margin-top:20px;
      color:var(--muted);
      text-align:center;
      font-size:11px;
    }

    @media (max-width:1100px){
      .overview{
        grid-template-columns:1fr;
      }
      .sidebar{position:static}
      .summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    }

    @media (max-width:760px){
      .app{
        width:min(100% - 18px,1440px);
      }

      .header{
        flex-direction:column;
      }

      .header-actions{
        justify-content:flex-start;
      }

      .grid-2,.grid-3,.grid-4{
        grid-template-columns:1fr;
      }

      .summary-grid{
        grid-template-columns:1fr 1fr;
      }

      .product-choice{
        grid-template-columns:90px 1fr;
      }

      .product-choice > :last-child{
        grid-column:1/-1;
      }

      .rx-scroll{
        overflow-x:auto;
      }

      .rx-table{
        min-width:610px;
      }
    }
  </style>
</head>

<body>
  <main class="app">

    <header class="header">
      <div>
        <p class="eyebrow">Portal Optótica · Área do Optometrista</p>
        <h1>Atendimento #1287</h1>
      </div>

      <div class="header-actions">
        <div class="pill"><span class="dot"></span> OS em andamento</div>
        <a class="btn btn-secondary" id="abrirAreaCliente" href="area-cliente-portal-optotica-v3.html?telefone=5521999990000" style="text-decoration:none;display:inline-flex;align-items:center;">Área do cliente</a>
        <button class="btn btn-secondary" type="button" onclick="window.print()">Imprimir</button>
      </div>
    </header>

    <!-- SEQUÊNCIA PRINCIPAL -->
    <nav class="flow-wrap" aria-label="Fluxo do atendimento">
      <div class="flow">
        <a class="done" href="#cliente">
          <span class="step-number">✓</span>
          <span><strong>Cliente</strong><small>dados + DNP</small></span>
        </a>

        <a class="current" href="#os">
          <span class="step-number">2</span>
          <span><strong>OS / Orçamento</strong><small>lente + laboratório</small></span>
        </a>

        <a href="#armacao">
          <span class="step-number">3</span>
          <span><strong>Armação</strong><small>catálogo</small></span>
        </a>

        <a href="#comanda">
          <span class="step-number">4</span>
          <span><strong>Comanda final</strong><small>consolidação</small></span>
        </a>

        <a href="#pagamento">
          <span class="step-number">5</span>
          <span><strong>Pagamento</strong><small>online / balcão</small></span>
        </a>

        <a href="#producao">
          <span class="step-number">6</span>
          <span><strong>Produção</strong><small>lente + armação</small></span>
        </a>

        <a href="#logistica">
          <span class="step-number">7</span>
          <span><strong>Logística</strong><small>prazos + rastreio</small></span>
        </a>

        <a href="#montagem">
          <span class="step-number">8</span>
          <span><strong>Montagem</strong><small>conferência</small></span>
        </a>

        <a href="#entrega">
          <span class="step-number">9</span>
          <span><strong>Entrega</strong><small>cliente final</small></span>
        </a>
      </div>
    </nav>

    <div class="overview">
      <div class="stack">

        <!-- VISÃO GERAL -->
        <section class="card">
          <div class="card-head">
            <div>
              <p class="eyebrow">Cliente e pedidos</p>
              <h2>VISÃO GERAL</h2>
            </div>
          </div>

          <div class="card-body">

            <div class="orders-strip" id="ordersStrip" aria-label="Pedidos deste cliente">
              <button type="button" class="order-tab active" data-order="1287">
                Pedido #1287 <small>em andamento</small>
              </button>

              <button type="button" class="order-add" id="novoPedidoBtn" aria-label="Criar novo pedido">+</button>
            </div>

            <div class="summary-grid">
              <div class="stat">
                <span>Paciente</span>
                <strong id="overviewPaciente">Ana Souza</strong>
              </div>
              <div class="stat">
                <span>DNP</span>
                <strong id="overviewDnp">OD 31 · OE 30,5</strong>
              </div>
              <div class="stat">
                <span>Laboratório</span>
                <strong id="overviewLab">A definir</strong>
              </div>
              <div class="stat">
                <span>Armação</span>
                <strong id="overviewArmacao">Ainda não escolhida</strong>
              </div>
            </div>

            <div class="helper">Pedido selecionado: <strong id="pedidoSelecionado">#1287</strong> · pedidos incompletos permanecem salvos como <strong>em andamento</strong>.</div>
            <div class="progress"><div></div></div>
          </div>
        </section>

        <!-- 1 CLIENTE -->
        <section class="card step-section" id="cliente">
          <div class="card-head">
            <div class="step-title">
              <span class="step-badge">1</span>
              <div>
                <p class="eyebrow">Etapa concluída</p>
                <h2>Cliente</h2>
              </div>
            </div>
            <span class="complete-tag">Completo</span>
          </div>

          <div class="card-body">
            <div class="grid grid-3">
              <div class="field">
                <label>Nome completo</label>
                <input id="clienteNome" value="Ana Souza" />
              </div>

              <div class="field">
                <label>WhatsApp</label>
                <input id="clienteWhatsapp" value="(21) 99999-0000" />
              </div>

              <div class="field">
                <label>E-mail</label>
                <input id="clienteEmail" value="ana@email.com" />
              </div>
            </div>

            <div style="height:14px"></div>

            <div class="grid grid-3">
              <div class="field">
                <label>DNP OD</label>
                <input id="dnpOd" value="31" />
              </div>

              <div class="field">
                <label>DNP OE</label>
                <input id="dnpOe" value="30,5" />
              </div>

              <div class="field">
                <label>Foto de prova online</label>
                <input value="foto_prova_1287.jpg" readonly />
              </div>
            </div>

            <div style="height:14px"></div>

            <div class="photo-box">
              Foto de prova online do cliente<br>
              <small>Esta imagem vem da Área do Cliente e acompanha o atendimento.</small>
            </div>
          </div>
        </section>

        <!-- 2 OS -->
        <section class="card step-section" id="os">
          <div class="card-head">
            <div class="step-title">
              <span class="step-badge">2</span>
              <div>
                <p class="eyebrow">Etapa atual</p>
                <h2>OS Laboratorial + Orçamento</h2>
              </div>
            </div>
            <span class="pending-tag">Em andamento</span>
          </div>

          <div class="card-body">
            <div class="subsection">
              <h3>Receita</h3>
              <div class="rx-scroll">
                <table class="rx-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Esférico</th>
                      <th>Cilíndrico</th>
                      <th>Eixo</th>
                      <th>Adição</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>OD</th>
                      <td><input id="rxOdEsf" placeholder="+0,00"></td>
                      <td><input id="rxOdCil" placeholder="-0,00"></td>
                      <td><input id="rxOdEixo" placeholder="0°"></td>
                      <td><input id="rxOdAdicao" placeholder="+0,00"></td>
                    </tr>
                    <tr>
                      <th>OE</th>
                      <td><input id="rxOeEsf" placeholder="+0,00"></td>
                      <td><input id="rxOeCil" placeholder="-0,00"></td>
                      <td><input id="rxOeEixo" placeholder="0°"></td>
                      <td><input id="rxOeAdicao" placeholder="+0,00"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div style="height:14px"></div>

            <div class="grid grid-2">
              <div class="subsection">
                <h3>Definição da lente</h3>

                <div class="grid grid-2">
                  <div class="field">
                    <label class="required">Tipo de lente</label>
                    <select id="tipoLente">
                      <option value="">Selecione</option>
                      <option>Visão simples</option>
                      <option>Multifocal</option>
                      <option>Solar com grau</option>
                      <option>Antirreflexo</option>
                    </select>
                  </div>

                  <div class="field">
                    <label>Índice</label>
                    <select id="indiceLente">
                      <option>1.50</option>
                      <option>1.56</option>
                      <option>1.60</option>
                      <option>1.67</option>
                      <option>1.74</option>
                    </select>
                  </div>

                  <div class="field">
                    <label>Material</label>
                    <select id="materialLente">
                      <option>Resina</option>
                      <option>Policarbonato</option>
                      <option>Trivex</option>
                      <option>Outro</option>
                    </select>
                  </div>

                  <div class="field">
                    <label>Tratamento</label>
                    <select id="tratamentoLente">
                      <option>Antirreflexo</option>
                      <option>Verniz</option>
                      <option>Filtro azul</option>
                      <option>Fotossensível</option>
                    </select>
                  </div>

                  <div class="field" style="grid-column:1/-1">
                    <label class="required">Laboratório</label>
                    <input id="laboratorio" list="laboratoriosLista" placeholder="Digite ou escolha um laboratório" />
                    <datalist id="laboratoriosLista">
                      <option value="Laboratório A"></option>
                      <option value="Laboratório B"></option>
                      <option value="Laboratório C"></option>
                    </datalist>
                    <div class="helper">O nome pode ser digitado livremente e passa a acompanhar este orçamento.</div>
                  </div>
                </div>
              </div>

              <div class="subsection">
                <h3>Novo orçamento</h3>

                <div class="field">
                  <label class="required">Valor do orçamento</label>
                  <div class="money">
                    <input id="valorProposto" placeholder="0,00" />
                  </div>
                </div>

                <div style="height:10px"></div>

                <div class="field">
                  <label>Observações</label>
                  <textarea id="obsOrcamento" placeholder="Condições, prazo, upgrade, observações do laboratório..."></textarea>
                  <div class="helper">Estas observações serão levadas para a Comanda Final quando este orçamento for escolhido.</div>
                </div>

                <div class="actions">
                  <button class="btn btn-primary" type="button" id="adicionarOrcamento">Adicionar orçamento</button>
                </div>
              </div>
            </div>

            <div style="height:14px"></div>

            <div class="subsection">
              <h3>Ordens de serviço / orçamentos</h3>
              <div class="helper" style="margin-bottom:10px">
                Cadastre quantas opções forem necessárias. Depois selecione a melhor opção para seguir com o pedido.
              </div>

              <div class="os-list" id="orcamentosLista">
                <div class="empty-budget" id="orcamentosVazio">
                  Nenhum orçamento adicionado ainda.
                </div>
              </div>
            </div>

            <div class="actions">
              <button class="btn btn-secondary" type="button">Salvar rascunho</button>
              <a class="btn btn-primary" href="#armacao" style="text-decoration:none;display:inline-flex;align-items:center;">Avançar para armação</a>
            </div>
          </div>
        </section>

        <!-- 3 ARMAÇÃO -->
        <section class="card step-section" id="armacao">
          <div class="card-head">
            <div class="step-title">
              <span class="step-badge">3</span>
              <div>
                <p class="eyebrow">Próxima etapa</p>
                <h2>Escolha da armação</h2>
              </div>
            </div>
            <span class="pending-tag">Pendente</span>
          </div>

          <div class="card-body">
            <div class="product-choice">
              <div class="product-img">Nenhuma armação escolhida</div>

              <div>
                <strong id="armacaoNome">Armação ainda não definida</strong>
                <div class="helper">A escolha será feita pelo catálogo e vinculada a esta OS.</div>
              </div>

              <button class="btn btn-primary" type="button" id="simularArmacao">
                Abrir catálogo
              </button>
            </div>

            <div style="height:14px"></div>

            <div class="grid grid-3">
              <div class="field">
                <label>SKU</label>
                <input id="skuArmacao" readonly placeholder="Preenchido após escolha" />
              </div>

              <div class="field">
                <label>Cor</label>
                <input id="corArmacao" readonly placeholder="Preenchido após escolha" />
              </div>

              <div class="field">
                <label>Origem / fornecedor</label>
                <input id="origemArmacao" readonly placeholder="Preenchido após escolha" />
              </div>
            </div>
          </div>
        </section>

        <!-- 4 COMANDA -->
        <section class="card step-section" id="comanda">
          <div class="card-head">
            <div class="step-title">
              <span class="step-badge">4</span>
              <div>
                <p class="eyebrow">Consolidação</p>
                <h2>Comanda final</h2>
              </div>
            </div>
            <span class="pending-tag">Aguardando armação</span>
          </div>

          <div class="card-body">
            <div class="grid grid-3">
              <div class="subsection">
                <h3>Cliente</h3>
                <div class="summary-row"><span>Nome</span><strong id="comandaPaciente">Ana Souza</strong></div>
                <div class="summary-row"><span>DNP</span><strong id="comandaDnp">31 / 30,5</strong></div>
              </div>

              <div class="subsection">
                <h3>Lente</h3>
                <div class="summary-row"><span>Tipo</span><strong id="comandaLente">Não definida</strong></div>
                <div class="summary-row"><span>Laboratório</span><strong id="comandaLab">Não definido</strong></div>
              </div>

              <div class="subsection">
                <h3>Armação</h3>
                <div class="summary-row"><span>Modelo</span><strong id="comandaArmacao">Não definida</strong></div>
                <div class="summary-row"><span>SKU</span><strong id="comandaSku">—</strong></div>
              </div>
            </div>

            <div style="height:14px"></div>

            <div class="field">
              <label>Observações herdadas do orçamento escolhido</label>
              <textarea id="comandaObsOrcamento" readonly placeholder="As observações da opção de orçamento selecionada aparecerão aqui automaticamente."></textarea>
              <div class="helper">Este conteúdo vem da etapa 2 e permanece vinculado à opção escolhida.</div>
            </div>

            <div style="height:14px"></div>

            <div class="grid grid-4">
              <div class="field"><label>Altura OD</label><input placeholder="mm"></div>
              <div class="field"><label>Altura OE</label><input placeholder="mm"></div>
              <div class="field"><label>Ponte</label><input placeholder="mm"></div>
              <div class="field"><label>Diagonal maior</label><input placeholder="mm"></div>
            </div>

            <div style="height:14px"></div>

            <div class="field">
              <label>Observações laboratoriais finais</label>
              <textarea placeholder="Montagem, acabamento, conferência e instruções especiais..."></textarea>
            </div>

            <div class="actions">
              <button class="btn btn-primary" type="button">Confirmar comanda final</button>
            </div>
          </div>
        </section>

        <!-- 5 PAGAMENTO -->
        <section class="card step-section" id="pagamento">
          <div class="card-head">
            <div class="step-title">
              <span class="step-badge">5</span>
              <div>
                <p class="eyebrow">Financeiro</p>
                <h2>Pagamento</h2>
              </div>
            </div>
            <span class="pending-tag">Pendente</span>
          </div>

          <div class="card-body">
            <div class="grid grid-2">
              <div class="field">
                <label class="required">Valor final da venda</label>
                <div class="money"><input id="valorFinal" placeholder="0,00"></div>
                <div class="helper">O valor final apresentado ao cliente. Custos internos permanecem separados.</div>
              </div>

              <div class="field">
                <label>Forma de confirmação</label>
                <div class="choice-row">
                  <label class="choice">
                    <input type="radio" name="pagamento" value="dinheiro" checked>
                    <span>Dinheiro</span>
                  </label>
                  <label class="choice">
                    <input type="radio" name="pagamento" value="pix">
                    <span>Pix</span>
                  </label>
                  <label class="choice">
                    <input type="radio" name="pagamento" value="link">
                    <span>Link de pagamento</span>
                  </label>
                  <label class="choice">
                    <input type="radio" name="pagamento" value="maquina">
                    <span>Máquina de cartão</span>
                  </label>
                </div>
              </div>
            </div>

            <div class="actions">
              <button class="btn btn-success" type="button">Confirmar pagamento</button>
            </div>
          </div>
        </section>

        <!-- 6 PRODUÇÃO -->
        <section class="card step-section" id="producao">
          <div class="card-head">
            <div class="step-title">
              <span class="step-badge">6</span>
              <div>
                <p class="eyebrow">Após pagamento</p>
                <h2>Produção</h2>
              </div>
            </div>
            <span class="pending-tag">Bloqueado até pagamento</span>
          </div>

          <div class="card-body">
            <div class="grid grid-2">
              <div class="subsection">
                <h3>Pedido da armação</h3>
                <div class="field">
                  <label>Status</label>
                  <select>
                    <option>Aguardando pedido</option>
                    <option>Pedido realizado</option>
                    <option>Confirmado pelo fornecedor</option>
                    <option>Indisponível</option>
                  </select>
                </div>
                <div style="height:10px"></div>
                <div class="field">
                  <label>Nº pedido fornecedor</label>
                  <input placeholder="Código / referência" />
                </div>
              </div>

              <div class="subsection">
                <h3>Produção da lente</h3>
                <div class="field">
                  <label>Status</label>
                  <select>
                    <option>Aguardando envio</option>
                    <option>Enviado ao laboratório</option>
                    <option>Confirmado pelo laboratório</option>
                    <option>Em produção</option>
                    <option>Pronta</option>
                  </select>
                </div>
                <div style="height:10px"></div>
                <div class="field">
                  <label>Nº OS do laboratório</label>
                  <input placeholder="Código / referência" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 7 LOGÍSTICA -->
        <section class="card step-section" id="logistica">
          <div class="card-head">
            <div class="step-title">
              <span class="step-badge">7</span>
              <div>
                <p class="eyebrow">Acompanhamento</p>
                <h2>Produção e logística</h2>
              </div>
            </div>
            <span class="pending-tag">Pendente</span>
          </div>

          <div class="card-body">
            <div class="grid grid-2">
              <div class="subsection">
                <h3>Armação</h3>
                <div class="timeline">
                  <div class="timeline-item done">
                    <div class="timeline-icon">✓</div>
                    <div><strong>Pedido registrado</strong><small>Fornecedor recebeu a solicitação.</small></div>
                    <div class="timeline-date">—</div>
                  </div>
                  <div class="timeline-item">
                    <div class="timeline-icon">2</div>
                    <div><strong>Em trânsito</strong><small>Rastreio e previsão de chegada.</small></div>
                    <div class="timeline-date">Previsão —</div>
                  </div>
                  <div class="timeline-item">
                    <div class="timeline-icon">3</div>
                    <div><strong>Recebida</strong><small>Disponível para montagem.</small></div>
                    <div class="timeline-date">—</div>
                  </div>
                </div>
              </div>

              <div class="subsection">
                <h3>Lentes</h3>
                <div class="timeline">
                  <div class="timeline-item">
                    <div class="timeline-icon">1</div>
                    <div><strong>Laboratório confirmou</strong><small>OS aceita para produção.</small></div>
                    <div class="timeline-date">—</div>
                  </div>
                  <div class="timeline-item">
                    <div class="timeline-icon">2</div>
                    <div><strong>Em produção</strong><small>Previsão informada pelo laboratório.</small></div>
                    <div class="timeline-date">Previsão —</div>
                  </div>
                  <div class="timeline-item">
                    <div class="timeline-icon">3</div>
                    <div><strong>Prontas</strong><small>Lentes disponíveis para montagem.</small></div>
                    <div class="timeline-date">—</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 8 MONTAGEM -->
        <section class="card step-section" id="montagem">
          <div class="card-head">
            <div class="step-title">
              <span class="step-badge">8</span>
              <div>
                <p class="eyebrow">Finalização técnica</p>
                <h2>Montagem</h2>
              </div>
            </div>
            <span class="pending-tag">Aguardando materiais</span>
          </div>

          <div class="card-body">
            <div class="grid grid-3">
              <div class="field">
                <label>Armação recebida</label>
                <select><option>Não</option><option>Sim</option></select>
              </div>
              <div class="field">
                <label>Lentes recebidas</label>
                <select><option>Não</option><option>Sim</option></select>
              </div>
              <div class="field">
                <label>Status da montagem</label>
                <select>
                  <option>Aguardando</option>
                  <option>Em montagem</option>
                  <option>Em conferência</option>
                  <option>Concluída</option>
                </select>
              </div>
            </div>

            <div style="height:14px"></div>

            <div class="field">
              <label>Conferência final</label>
              <textarea placeholder="Conferência de grau, eixo, DNP, altura, acabamento e integridade da armação..."></textarea>
            </div>
          </div>
        </section>

        <!-- 9 ENTREGA -->
        <section class="card step-section" id="entrega">
          <div class="card-head">
            <div class="step-title">
              <span class="step-badge">9</span>
              <div>
                <p class="eyebrow">Conclusão</p>
                <h2>Entrega</h2>
              </div>
            </div>
            <span class="pending-tag">Pendente</span>
          </div>

          <div class="card-body">
            <div class="grid grid-3">
              <div class="field">
                <label>Destino</label>
                <select>
                  <option>Loja</option>
                  <option>Optometrista</option>
                  <option>Cliente final</option>
                </select>
              </div>
              <div class="field">
                <label>Data de envio / retirada</label>
                <input type="date">
              </div>
              <div class="field">
                <label>Recebido por</label>
                <input placeholder="Nome do responsável">
              </div>
            </div>

            <div style="height:14px"></div>

            <div class="field">
              <label>Confirmação de entrega ao cliente final</label>
              <textarea placeholder="Data, responsável, observações e eventuais ajustes realizados na entrega..."></textarea>
            </div>

            <div class="actions">
              <button class="btn btn-success" type="button">Finalizar atendimento</button>
            </div>
          </div>
        </section>

      </div>

      <!-- RESUMO LATERAL -->
      <aside class="card sidebar">
        <div class="card-head">
          <div>
            <p class="eyebrow">Resumo vivo</p>
            <h2>Atendimento</h2>
          </div>
        </div>

        <div class="card-body">
          <div class="summary-row"><span>Paciente</span><strong id="sidePaciente">Ana Souza</strong></div>
          <div class="summary-row"><span>DNP</span><strong id="sideDnp">31 / 30,5</strong></div>
          <div class="summary-row"><span>Lente</span><strong id="sideLente">Não definida</strong></div>
          <div class="summary-row"><span>Laboratório</span><strong id="sideLab">Não definido</strong></div>
          <div class="summary-row"><span>Armação</span><strong id="sideArmacao">Não definida</strong></div>
          <div class="summary-row"><span>Valor proposto</span><strong id="sideValor">R$ 0,00</strong></div>

          <div class="notice">
            Cada etapa reaproveita as informações das etapas anteriores. O atendimento vai sendo complementado sem duplicar cadastros.
          </div>

          <div class="actions">
            <button class="btn btn-secondary" type="button">Salvar atendimento</button>
            <button class="btn btn-primary" type="button">Ver histórico</button>
          </div>
        </div>
      </aside>
    </div>

    <div class="footer-note">
      Protótipo de interface. Integrações de autenticação, banco de dados, catálogo, pagamento, laboratório e logística ainda precisam ser conectadas ao backend.
    </div>

  </main>

  <script>
    const clienteNome = document.getElementById('clienteNome');
    const dnpOd = document.getElementById('dnpOd');
    const dnpOe = document.getElementById('dnpOe');
    const tipoLente = document.getElementById('tipoLente');
    const laboratorio = document.getElementById('laboratorio');
    const valorProposto = document.getElementById('valorProposto');

    function sync(){
      const nome = clienteNome.value || 'Não informado';
      const dnp = `${dnpOd.value || '—'} / ${dnpOe.value || '—'}`;
      const lente = tipoLente.value || 'Não definida';
      const lab = laboratorio.value || 'Não definido';

      document.getElementById('overviewPaciente').textContent = nome;
      document.getElementById('overviewDnp').textContent = `OD ${dnpOd.value || '—'} · OE ${dnpOe.value || '—'}`;
      document.getElementById('overviewLab').textContent = lab;

      document.getElementById('comandaPaciente').textContent = nome;
      document.getElementById('comandaDnp').textContent = dnp;
      document.getElementById('comandaLente').textContent = lente;
      document.getElementById('comandaLab').textContent = lab;

      document.getElementById('sidePaciente').textContent = nome;
      document.getElementById('sideDnp').textContent = dnp;
      document.getElementById('sideLente').textContent = lente;
      document.getElementById('sideLab').textContent = lab;
    }

    [clienteNome,dnpOd,dnpOe,tipoLente,laboratorio].forEach(el => {
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });

    function formatMoney(raw){
      const digits = raw.replace(/\D/g,'');
      if(!digits) return '';
      return (Number(digits)/100).toLocaleString('pt-BR',{
        minimumFractionDigits:2,
        maximumFractionDigits:2
      });
    }

    valorProposto.addEventListener('input', e => {
      e.target.value = formatMoney(e.target.value);
      document.getElementById('sideValor').textContent = e.target.value ? 'R$ ' + e.target.value : 'R$ 0,00';
    });

    document.getElementById('valorFinal').addEventListener('input', e => {
      e.target.value = formatMoney(e.target.value);
    });


    let budgetCounter = 0;

    function applySelectedBudget(item) {
      const details = item.dataset.details || '';
      const lab = item.dataset.lab || '';
      const price = item.dataset.price || '';
      const obs = item.dataset.obs || '';

      if (details) {
        document.getElementById('comandaLente').textContent = details;
        document.getElementById('sideLente').textContent = details;
      }
      if (lab) {
        document.getElementById('comandaLab').textContent = lab;
        document.getElementById('sideLab').textContent = lab;
        document.getElementById('overviewLab').textContent = lab;
      }
      if (price) {
        document.getElementById('sideValor').textContent = 'R$ ' + price;
        document.getElementById('valorFinal').value = price;
      }

      document.getElementById('comandaObsOrcamento').value = obs;
    }

    function refreshBudgetSelection() {
      document.querySelectorAll('.budget-option').forEach(item => {
        const radio = item.querySelector('input[type="radio"]');
        item.classList.toggle('selected-budget', radio.checked);

        item.onclick = (event) => {
          if (event.target.tagName !== 'INPUT') radio.checked = true;

          document.querySelectorAll('.budget-option').forEach(i => {
            i.classList.remove('selected-budget');
            const r = i.querySelector('input[type="radio"]');
            if (r) r.checked = false;
          });

          radio.checked = true;
          item.classList.add('selected-budget');
          applySelectedBudget(item);
        };
      });
    }

    document.getElementById('adicionarOrcamento').addEventListener('click', () => {
      const tipo = document.getElementById('tipoLente').value;
      const indice = document.getElementById('indiceLente').value;
      const material = document.getElementById('materialLente').value;
      const tratamento = document.getElementById('tratamentoLente').value;
      const lab = document.getElementById('laboratorio').value;
      const valor = document.getElementById('valorProposto').value;
      const obs = document.getElementById('obsOrcamento').value.trim();

      if (!tipo || !lab || !valor) {
        alert('Preencha tipo de lente, laboratório e valor antes de adicionar o orçamento.');
        return;
      }

      budgetCounter += 1;

      const emptyState = document.getElementById('orcamentosVazio');
      if (emptyState) emptyState.remove();

      const isFirst = document.querySelectorAll('.budget-option').length === 0;

      const item = document.createElement('div');
      item.className = 'os-item budget-option' + (isFirst ? ' selected-budget' : '');
      item.dataset.budgetId = String(budgetCounter);
      item.dataset.details = `${tipo} · ${indice} · ${material} · ${tratamento}`;
      item.dataset.lab = lab;
      item.dataset.price = valor;
      item.dataset.obs = obs;

      item.innerHTML = `
        <div style="display:flex;gap:12px;align-items:flex-start">
          <input type="radio" name="orcamento_escolhido" value="${budgetCounter}" ${isFirst ? 'checked' : ''} style="width:auto;margin-top:4px">
          <div>
            <strong>${tipo} · ${indice} · ${material} · ${tratamento}</strong>
            <small>${lab}${obs ? ' · ' + obs : ''}</small>
          </div>
        </div>
        <div class="price">R$ ${valor}</div>
      `;

      document.getElementById('orcamentosLista').appendChild(item);

      if (isFirst) {
        applySelectedBudget(item);
      }

      document.getElementById('valorProposto').value = '';
      document.getElementById('obsOrcamento').value = '';

      refreshBudgetSelection();
    });

    refreshBudgetSelection();

    document.getElementById('simularArmacao').addEventListener('click', () => {
      const modelo = 'Modelo selecionado no catálogo';
      document.getElementById('armacaoNome').textContent = modelo;
      document.getElementById('skuArmacao').value = 'OPT-AR-0142';
      document.getElementById('corArmacao').value = 'Preto';
      document.getElementById('origemArmacao').value = 'Catálogo Optótica';

      document.getElementById('overviewArmacao').textContent = modelo;
      document.getElementById('comandaArmacao').textContent = modelo;
      document.getElementById('comandaSku').textContent = 'OPT-AR-0142';
      document.getElementById('sideArmacao').textContent = modelo;

      alert('Protótipo: aqui será aberta a integração real com o catálogo.');
    });


    const ORDERS_STORAGE_KEY = 'optotica_cliente_demo_pedidos';
    const ACTIVE_ORDER_STORAGE_KEY = 'optotica_cliente_demo_pedido_ativo';

    function getStoredOrders() {
      try {
        const saved = JSON.parse(localStorage.getItem(ORDERS_STORAGE_KEY) || '[]');
        return Array.isArray(saved) ? saved : [];
      } catch (e) {
        return [];
      }
    }

    function saveStoredOrders(orders) {
      localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
    }

    function ensureInitialOrder() {
      const orders = getStoredOrders();

      if (!orders.some(order => String(order.numero) === '1287')) {
        orders.unshift({
          numero: 1287,
          status: 'em andamento',
          criadoEm: new Date().toISOString(),
          inicial: true
        });
        saveStoredOrders(orders);
      }

      return orders;
    }

    function nextOrderNumber(orders) {
      const numbers = orders
        .map(order => Number(order.numero))
        .filter(number => Number.isFinite(number));

      return numbers.length ? Math.max(...numbers) + 1 : 1287;
    }

    function resetOrderFlowForNewOrder() {
      /*
       * Mantém dados do CLIENTE, pois o novo pedido pertence ao mesmo cadastro.
       * Limpa somente os dados específicos da nova OS/pedido.
       */

      // Receita
      document.querySelectorAll('#os .rx-table input').forEach(input => input.value = '');

      // Definição da lente / laboratório / orçamento
      document.getElementById('tipoLente').value = '';
      document.getElementById('indiceLente').value = '1.50';
      document.getElementById('materialLente').value = 'Resina';
      document.getElementById('tratamentoLente').value = 'Antirreflexo';
      document.getElementById('laboratorio').value = '';
      document.getElementById('valorProposto').value = '';
      document.getElementById('obsOrcamento').value = '';

      // Lista de orçamentos
      document.getElementById('orcamentosLista').innerHTML = `
        <div class="empty-budget" id="orcamentosVazio">
          Nenhum orçamento adicionado ainda.
        </div>
      `;
      budgetCounter = 0;

      // Armação
      document.getElementById('armacaoNome').textContent = 'Armação ainda não definida';
      document.getElementById('skuArmacao').value = '';
      document.getElementById('corArmacao').value = '';
      document.getElementById('origemArmacao').value = '';

      document.getElementById('overviewArmacao').textContent = 'Ainda não escolhida';
      document.getElementById('comandaArmacao').textContent = 'Não definida';
      document.getElementById('comandaSku').textContent = '—';
      document.getElementById('sideArmacao').textContent = 'Não definida';

      // Comanda
      document.getElementById('comandaLente').textContent = 'Não definida';
      document.getElementById('comandaLab').textContent = 'Não definido';
      document.getElementById('comandaObsOrcamento').value = '';

      // Valores
      document.getElementById('valorFinal').value = '';
      document.getElementById('sideValor').textContent = 'R$ 0,00';

      // Resumos
      document.getElementById('overviewLab').textContent = 'A definir';
      document.getElementById('sideLente').textContent = 'Não definida';
      document.getElementById('sideLab').textContent = 'Não definido';

      // Volta a etapa atual para OS / Orçamento
      document.querySelectorAll('.flow a').forEach(link => {
        link.classList.remove('current');
      });
      const osFlow = document.querySelector('.flow a[href="#os"]');
      if (osFlow) osFlow.classList.add('current');

      sync();
    }

    function activateOrder(orderNumber, options = {}) {
      document.querySelectorAll('.order-tab').forEach(tab => {
        tab.classList.toggle('active', String(tab.dataset.order) === String(orderNumber));
      });

      document.getElementById('pedidoSelecionado').textContent = '#' + orderNumber;
      document.querySelector('h1').textContent = 'Atendimento #' + orderNumber;
      localStorage.setItem(ACTIVE_ORDER_STORAGE_KEY, String(orderNumber));

      if (options.isNew) {
        resetOrderFlowForNewOrder();
        window.location.hash = 'os';
      }
    }

    function bindOrderTab(tab) {
      tab.addEventListener('click', () => {
        activateOrder(tab.dataset.order);
      });
    }

    function renderStoredOrders() {
      const strip = document.getElementById('ordersStrip');
      const addButton = document.getElementById('novoPedidoBtn');
      const orders = ensureInitialOrder();

      // Remove all order tabs and rebuild from persisted data.
      strip.querySelectorAll('.order-tab').forEach(tab => tab.remove());

      orders
        .sort((a, b) => Number(a.numero) - Number(b.numero))
        .forEach(order => {
          const tab = document.createElement('button');
          tab.type = 'button';
          tab.className = 'order-tab';
          tab.dataset.order = String(order.numero);
          tab.innerHTML = `Pedido #${order.numero} <small>${order.status || 'em andamento'}</small>`;
          strip.insertBefore(tab, addButton);
          bindOrderTab(tab);
        });

      const preferredActive = localStorage.getItem(ACTIVE_ORDER_STORAGE_KEY);
      const exists = orders.some(order => String(order.numero) === String(preferredActive));
      activateOrder(exists ? preferredActive : 1287);
    }

    document.getElementById('novoPedidoBtn').addEventListener('click', () => {
      const orders = ensureInitialOrder();
      const numero = nextOrderNumber(orders);

      const novoPedido = {
        numero,
        status: 'em andamento',
        criadoEm: new Date().toISOString()
      };

      /*
       * Salva imediatamente. O pedido existe mesmo sem receita, lente,
       * armação, orçamento ou pagamento preenchidos.
       */
      orders.push(novoPedido);
      saveStoredOrders(orders);

      const addButton = document.getElementById('novoPedidoBtn');
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'order-tab';
      tab.dataset.order = String(numero);
      tab.innerHTML = `Pedido #${numero} <small>em andamento</small>`;
      document.getElementById('ordersStrip').insertBefore(tab, addButton);
      bindOrderTab(tab);

      activateOrder(numero, { isNew: true });
    });

    renderStoredOrders();
    sync();

    // ==========================================================
    // PONTE OPTOMETRISTA -> CLIENTE
    // O WhatsApp normalizado funciona como ID único do cliente.
    // No sistema real este objeto será persistido no backend.
    // ==========================================================
    function normalizePhone(value) {
      return String(value || '').replace(/\D/g, '');
    }

    function currentPhoneId() {
      let digits = normalizePhone(document.getElementById('clienteWhatsapp').value);
      if (digits.length === 11) digits = '55' + digits;
      return digits || '5521999990000';
    }

    function clientStorageKey(phone) {
      return 'optotica_cliente_phone_' + phone;
    }

    function readClientRecord(phone) {
      try {
        return JSON.parse(localStorage.getItem(clientStorageKey(phone)) || 'null');
      } catch (e) {
        return null;
      }
    }

    function currentOrderNumber() {
      return String(document.getElementById('pedidoSelecionado').textContent || '')
        .replace(/\D/g, '') || '1287';
    }

    function collectBudgets() {
      return Array.from(document.querySelectorAll('.budget-option')).map(item => {
        const radio = item.querySelector('input[type="radio"]');
        return {
          id: String(item.dataset.budgetId || ''),
          details: item.dataset.details || '',
          lab: item.dataset.lab || '',
          price: item.dataset.price || '',
          obs: item.dataset.obs || '',
          selected: !!(radio && radio.checked)
        };
      });
    }

    function syncSharedClientRecord() {
      const phone = currentPhoneId();
      const orderNumber = currentOrderNumber();

      const existing = readClientRecord(phone) || {
        phone,
        customer: {},
        professional: {
          name: 'Optometrista responsável',
          registration: 'Cadastro profissional',
          stamp: 'Carimbo cadastrado no perfil profissional',
          signature: 'Assinatura cadastrada no perfil profissional'
        },
        orders: {}
      };

      existing.phone = phone;
      existing.customer = {
        ...(existing.customer || {}),
        name: document.getElementById('clienteNome').value || '',
        whatsapp: document.getElementById('clienteWhatsapp').value || '',
        email: document.getElementById('clienteEmail').value || '',
        dnpOd: document.getElementById('dnpOd').value || '',
        dnpOe: document.getElementById('dnpOe').value || ''
      };

      const selectedBudget = document.querySelector('.budget-option input[type="radio"]:checked');
      const selectedBudgetItem = selectedBudget ? selectedBudget.closest('.budget-option') : null;

      existing.orders = existing.orders || {};
      existing.orders[orderNumber] = {
        ...(existing.orders[orderNumber] || {}),
        number: orderNumber,
        status: 'em andamento',
        updatedAt: new Date().toISOString(),
        prescription: {
          od: {
            esf: document.getElementById('rxOdEsf')?.value || '',
            cil: document.getElementById('rxOdCil')?.value || '',
            eixo: document.getElementById('rxOdEixo')?.value || '',
            adicao: document.getElementById('rxOdAdicao')?.value || ''
          },
          oe: {
            esf: document.getElementById('rxOeEsf')?.value || '',
            cil: document.getElementById('rxOeCil')?.value || '',
            eixo: document.getElementById('rxOeEixo')?.value || '',
            adicao: document.getElementById('rxOeAdicao')?.value || ''
          }
        },
        budgets: collectBudgets(),
        selectedBudgetId: selectedBudgetItem ? String(selectedBudgetItem.dataset.budgetId || '') : '',
        lensDraft: {
          type: document.getElementById('tipoLente')?.value || '',
          index: document.getElementById('indiceLente')?.value || '',
          material: document.getElementById('materialLente')?.value || '',
          treatment: document.getElementById('tratamentoLente')?.value || '',
          lab: document.getElementById('laboratorio')?.value || ''
        },
        selectedFrame: {
          name: document.getElementById('sideArmacao')?.textContent || '',
          sku: document.getElementById('skuArmacao')?.value || '',
          color: document.getElementById('corArmacao')?.value || '',
          origin: document.getElementById('origemArmacao')?.value || ''
        },
        finalValue: document.getElementById('valorFinal')?.value || ''
      };

      localStorage.setItem(clientStorageKey(phone), JSON.stringify(existing));

      const clientLink = document.getElementById('abrirAreaCliente');
      if (clientLink) {
        clientLink.href = 'area-cliente-portal-optotica-v3.html?telefone=' + encodeURIComponent(phone);
      }
    }

    // Mantém o espelho atualizado conforme o profissional preenche o atendimento.
    document.addEventListener('input', () => setTimeout(syncSharedClientRecord, 0));
    document.addEventListener('change', () => setTimeout(syncSharedClientRecord, 0));
    document.addEventListener('click', () => setTimeout(syncSharedClientRecord, 30));

    // Antes de trocar de pedido, grava o pedido atual.
    document.getElementById('ordersStrip').addEventListener('click', event => {
      if (event.target.closest('.order-tab') || event.target.closest('#novoPedidoBtn')) {
        syncSharedClientRecord();
      }
    }, true);

    // Ao abrir a página, cria/atualiza o registro compartilhado.
    setTimeout(syncSharedClientRecord, 100);

  </script>
  <script src="/optotica-core/professional-patient-sync.js?v=20260901-cssfix1"></script>
</body>
</html>
