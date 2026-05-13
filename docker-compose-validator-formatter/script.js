// Dependencies: js-yaml 4.1.0 (MIT) — loaded via <script src="..."> in index.html
// Namespace prefix: dcv-

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // DOM helper
  // ─────────────────────────────────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };

  // ─────────────────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────────────────
  var _allIssues    = [];
  var _fmtYaml      = '';
  var _convertYaml  = '';

  // ─────────────────────────────────────────────────────────────────────────
  // Toast
  // ─────────────────────────────────────────────────────────────────────────
  function showToast(msg) {
    var t = $('dcv-toast');
    t.textContent = msg || '✅ Done';
    t.classList.add('dcv-show');
    setTimeout(function () { t.classList.remove('dcv-show'); }, 2200);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Clipboard
  // ─────────────────────────────────────────────────────────────────────────
  function copyText(text, label) {
    if (!text) { showToast('⚠️ Nothing to copy'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { showToast('📋 ' + (label || 'Copied!')); })
        .catch(fallback);
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showToast('📋 ' + (label || 'Copied!')); }
      catch (e) { showToast('❌ Copy failed'); }
      document.body.removeChild(ta);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Download
  // ─────────────────────────────────────────────────────────────────────────
  function download(filename, content) {
    var a = document.createElement('a');
    var blob = new Blob([content], { type: 'text/yaml;charset=utf-8' });
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tab switching
  // ─────────────────────────────────────────────────────────────────────────
  function switchTab(tab) {
    ['validate', 'convert'].forEach(function (t) {
      var btn  = $('dcv-tab-' + t);
      var pane = $('dcv-pane-' + t);
      var active = (t === tab);
      btn.classList.toggle('dcv-tab--active', active);
      btn.setAttribute('aria-selected', active);
      pane.classList.toggle('dcv-hidden', !active);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Line counter
  // ─────────────────────────────────────────────────────────────────────────
  function updateLineCount() {
    var v = $('dcv-yaml-input').value;
    var n = v ? v.split('\n').length : 0;
    $('dcv-linecount').textContent = n + ' line' + (n !== 1 ? 's' : '');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Filter chip state
  // ─────────────────────────────────────────────────────────────────────────
  function updateChips() {
    ['error', 'warning', 'hint'].forEach(function (level) {
      var chip = $('dcv-chip-' + level);
      var chk  = $('dcv-chk-' + level);
      if (chip && chk) {
        chip.classList.toggle('dcv-chip--active', chk.checked);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // YAML VALIDATION ENGINE
  // ─────────────────────────────────────────────────────────────────────────
  function validateYaml(text) {
    var issues = [];
    var doc;

    // ── Parse ────────────────────────────────────────────────────────────
    try {
      doc = jsyaml.load(text);
    } catch (e) {
      var line = (e.mark && e.mark.line != null) ? e.mark.line + 1 : null;
      var msg  = (e.reason || e.message || String(e)).replace(/\s+at line.*$/i, '').trim();
      issues.push({ level: 'error', line: line, message: 'YAML syntax error: ' + msg });
      return { issues: issues, doc: null };
    }

    if (doc === null || doc === undefined) {
      issues.push({ level: 'error', message: 'Document is empty.' });
      return { issues: issues, doc: null };
    }

    if (typeof doc !== 'object' || Array.isArray(doc)) {
      issues.push({ level: 'error', message: 'Root must be a YAML mapping, not a ' + (Array.isArray(doc) ? 'list' : typeof doc) + '.' });
      return { issues: issues, doc: null };
    }

    // ── Root-level ────────────────────────────────────────────────────────

    if (doc.version !== undefined) {
      issues.push({
        level: 'warning',
        message: 'The top-level "version" field is obsolete in Compose Spec (Docker Compose v2+). It is silently ignored — remove it.',
        doc: 'https://docs.docker.com/compose/compose-file/04-version-and-name/'
      });
    }

    if (!doc.services) {
      issues.push({ level: 'error', message: 'Missing required top-level key "services".' });
      return { issues: issues, doc: doc };
    }

    if (typeof doc.services !== 'object' || Array.isArray(doc.services)) {
      issues.push({ level: 'error', message: '"services" must be a mapping, not a list.' });
      return { issues: issues, doc: doc };
    }

    var serviceNames = Object.keys(doc.services);

    if (serviceNames.length === 0) {
      issues.push({ level: 'warning', message: '"services" block is empty — no services defined.' });
      return { issues: issues, doc: doc };
    }

    // Global hint: no networks defined with multiple services
    if (!doc.networks && serviceNames.length > 1) {
      issues.push({
        level: 'hint',
        message: 'No top-level "networks" defined. All services share the auto-created default bridge network. Explicit networks improve isolation and service discovery.',
        doc: 'https://docs.docker.com/compose/compose-file/06-networks/'
      });
    }

    // ── Per-service ───────────────────────────────────────────────────────

    serviceNames.forEach(function (name) {
      var svc = doc.services[name];

      if (!svc || typeof svc !== 'object' || Array.isArray(svc)) {
        issues.push({ level: 'error', service: name, message: 'Service definition is empty or not a mapping.' });
        return;
      }

      // ERROR: no image and no build
      if (!svc.image && !svc.build) {
        issues.push({
          level: 'error', service: name,
          message: 'Missing both "image" and "build" — every service must define one.',
          doc: 'https://docs.docker.com/compose/compose-file/05-services/#image'
        });
      }

      // ERROR: ports format
      if (svc.ports) {
        if (!Array.isArray(svc.ports)) {
          issues.push({ level: 'error', service: name, message: '"ports" must be a list.' });
        } else {
          svc.ports.forEach(function (port, idx) {
            if (typeof port === 'object' && port !== null) return; // long-form OK
            var ps = String(port);
            // [ip:]host_port[-range]:container_port[-range][/protocol]
            var re = /^(\d{1,3}(?:\.\d{1,3}){3}:)?(\d{1,5}(?:-\d{1,5})?:)?\d{1,5}(?:-\d{1,5})?(\/(?:tcp|udp|sctp))?$/;
            if (!re.test(ps)) {
              issues.push({ level: 'error', service: name, message: 'Invalid port format at index ' + idx + ': "' + ps + '".' });
            }
          });
        }
      }

      // ERROR: depends_on references non-existent service
      if (svc.depends_on) {
        var deps = Array.isArray(svc.depends_on) ? svc.depends_on : Object.keys(svc.depends_on);
        deps.forEach(function (dep) {
          if (!doc.services[dep]) {
            issues.push({ level: 'error', service: name, message: '"depends_on" references "' + dep + '" which is not defined in services.' });
          }
        });
      }

      // WARNING: named volume not declared at top level
      if (svc.volumes && Array.isArray(svc.volumes)) {
        svc.volumes.forEach(function (v) {
          if (typeof v !== 'string') return;
          var vol = v.split(':')[0];
          if (!vol.startsWith('/') && !vol.startsWith('.') && !vol.startsWith('~') && vol !== '') {
            if (!doc.volumes || !doc.volumes[vol]) {
              issues.push({
                level: 'warning', service: name,
                message: 'Named volume "' + vol + '" is not declared under top-level "volumes". Add it or Docker Compose will error at runtime.',
                doc: 'https://docs.docker.com/compose/compose-file/07-volumes/'
              });
            }
          }
        });
      }

      // WARNING: no restart policy
      if (!svc.restart) {
        issues.push({ level: 'warning', service: name, message: 'No "restart" policy defined. Consider "unless-stopped" or "always" for production.' });
      }

      // WARNING: latest or no image tag
      if (svc.image) {
        var imgStr = String(svc.image);
        var colonIdx = imgStr.indexOf(':');
        var tag = colonIdx !== -1 ? imgStr.substring(colonIdx + 1) : null;
        if (!tag || tag === 'latest') {
          issues.push({
            level: 'warning', service: name,
            message: 'Image "' + imgStr + '" uses ' + (!tag ? 'no tag (implicit "latest")' : '"latest" tag') + '. Pin to a specific version for reproducible builds.',
            doc: 'https://docs.docker.com/develop/dev-best-practices/'
          });
        }
      }

      // WARNING: port binds to all interfaces
      if (svc.ports && Array.isArray(svc.ports)) {
        svc.ports.forEach(function (port) {
          if (typeof port === 'object') return;
          var ps = String(port);
          // short form "host:container" with no explicit IP binds to 0.0.0.0
          if (/^\d+:\d/.test(ps)) {
            issues.push({
              level: 'warning', service: name,
              message: 'Port "' + ps + '" binds to all interfaces (0.0.0.0). Use "127.0.0.1:' + ps + '" to restrict to localhost if external access is not needed.'
            });
          }
        });
      }

      // WARNING: privileged mode
      if (svc.privileged === true) {
        issues.push({
          level: 'warning', service: name,
          message: '"privileged: true" gives the container full access to the host. Use only when absolutely required.',
          doc: 'https://docs.docker.com/compose/compose-file/05-services/#privileged'
        });
      }

      // WARNING: network_mode host
      if (svc.network_mode === 'host') {
        issues.push({ level: 'warning', service: name, message: '"network_mode: host" bypasses Docker network isolation — the container shares the host\'s network stack.' });
      }

      // WARNING: potential secrets in environment
      if (svc.environment) {
        var envArr = Array.isArray(svc.environment)
          ? svc.environment.map(function (e) { return String(e).split('=')[0]; })
          : Object.keys(svc.environment);
        envArr.forEach(function (key) {
          if (/PASSWORD|SECRET|TOKEN|API_KEY|PASSWD|PRIVATE_KEY|ACCESS_KEY|CREDENTIALS/i.test(key)) {
            issues.push({
              level: 'warning', service: name,
              message: 'Environment variable "' + key + '" may contain a secret. Use Docker secrets or a .env file to avoid storing credentials in docker-compose.yml.',
              doc: 'https://docs.docker.com/compose/compose-file/09-secrets/'
            });
          }
        });
      }

      // WARNING: deprecated links
      if (svc.links && svc.links.length > 0) {
        issues.push({
          level: 'warning', service: name,
          message: '"links" is a legacy feature. Services on the same network can reach each other by service name — links are not needed.',
          doc: 'https://docs.docker.com/compose/compose-file/05-services/#links'
        });
      }

      // WARNING: build without context hint
      if (svc.build && typeof svc.build === 'string' && svc.build === '.') {
        // not a warning, fine
      }

      // HINT: no container_name
      if (!svc.container_name) {
        issues.push({ level: 'hint', service: name, message: 'No "container_name" set. Docker auto-generates one (e.g. project-web-1). An explicit name makes "docker exec" and log tailing easier.' });
      }

      // HINT: no healthcheck
      if (!svc.healthcheck) {
        issues.push({
          level: 'hint', service: name,
          message: 'No "healthcheck" defined. A healthcheck lets Compose wait for the service to be truly ready before starting dependents with "condition: service_healthy".',
          doc: 'https://docs.docker.com/compose/compose-file/05-services/#healthcheck'
        });
      }

      // HINT: no resource limits
      var hasLimits = (svc.deploy && svc.deploy.resources && svc.deploy.resources.limits) || svc.mem_limit;
      if (!hasLimits) {
        issues.push({
          level: 'hint', service: name,
          message: 'No resource limits. Without them, a runaway container can starve the host. Add deploy.resources.limits.memory to cap memory usage.',
          doc: 'https://docs.docker.com/compose/compose-file/deploy/#resources'
        });
      }

      // HINT: no logging config
      if (!svc.logging) {
        issues.push({
          level: 'hint', service: name,
          message: 'No "logging" config. Container logs are unbounded by default. Consider: logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }.',
          doc: 'https://docs.docker.com/compose/compose-file/05-services/#logging'
        });
      }
    });

    return { issues: issues, doc: doc };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render issues list
  // ─────────────────────────────────────────────────────────────────────────
  function renderIssues(issues) {
    var ec = 0, wc = 0, hc = 0;
    issues.forEach(function (iss) {
      if      (iss.level === 'error')   ec++;
      else if (iss.level === 'warning') wc++;
      else                              hc++;
    });

    $('dcv-cnt-error').textContent   = ec;
    $('dcv-cnt-warning').textContent = wc;
    $('dcv-cnt-hint').textContent    = hc;

    // Status bar
    var sb = $('dcv-status-bar');
    sb.className = 'dcv-status-bar';
    if (ec > 0) {
      sb.classList.add('dcv-status-bar--error');
      sb.textContent = '❌ ' + ec + ' error' + (ec > 1 ? 's' : '') +
        (wc > 0 ? '  ·  ' + wc + ' warning' + (wc > 1 ? 's' : '') : '');
    } else if (wc > 0) {
      sb.classList.add('dcv-status-bar--warning');
      sb.textContent = '⚠️ Valid YAML — ' + wc + ' warning' + (wc > 1 ? 's' : '') + ', no structural errors';
    } else {
      sb.classList.add('dcv-status-bar--ok');
      sb.textContent = '✅ Valid — no errors or warnings' + (hc > 0 ? '  ·  ' + hc + ' hints available' : '');
    }

    _allIssues = issues;
    applyFilter();
  }

  function applyFilter() {
    updateChips();

    var showE = $('dcv-chk-error').checked;
    var showW = $('dcv-chk-warning').checked;
    var showH = $('dcv-chk-hint').checked;

    var visible = _allIssues.filter(function (iss) {
      if (iss.level === 'error'   && !showE) return false;
      if (iss.level === 'warning' && !showW) return false;
      if (iss.level === 'hint'    && !showH) return false;
      return true;
    });

    var container = $('dcv-issues');
    container.innerHTML = '';

    if (visible.length === 0) {
      if (_allIssues.length > 0) {
        var empty = document.createElement('div');
        empty.className = 'dcv-issues-empty';
        empty.textContent = 'All issues hidden by filter.';
        container.appendChild(empty);
      }
      return;
    }

    var icons = { error: '🔴', warning: '🟡', hint: '🔵' };

    visible.forEach(function (iss) {
      var row  = document.createElement('div');
      row.className = 'dcv-issue dcv-issue--' + iss.level;

      var icon = document.createElement('span');
      icon.className = 'dcv-issue-icon';
      icon.textContent = icons[iss.level] || '•';
      row.appendChild(icon);

      var body = document.createElement('div');
      body.className = 'dcv-issue-body';

      var msg = document.createElement('div');
      msg.className = 'dcv-issue-msg';
      msg.textContent = iss.message;
      body.appendChild(msg);

      if (iss.service || iss.line || iss.doc) {
        var meta = document.createElement('div');
        meta.className = 'dcv-issue-meta';

        if (iss.service) {
          var st = document.createElement('span');
          st.className = 'dcv-tag dcv-tag--service';
          st.textContent = 'service: ' + iss.service;
          meta.appendChild(st);
        }

        if (iss.line) {
          var lt = document.createElement('span');
          lt.className = 'dcv-tag dcv-tag--line';
          lt.textContent = 'line ' + iss.line;
          meta.appendChild(lt);
        }

        if (iss.doc) {
          var dt = document.createElement('a');
          dt.className = 'dcv-tag dcv-tag--doc';
          dt.href   = iss.doc;
          dt.target = '_blank';
          dt.rel    = 'noopener noreferrer';
          dt.textContent = '📖 docs';
          meta.appendChild(dt);
        }

        body.appendChild(meta);
      }

      row.appendChild(body);
      container.appendChild(row);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // js-yaml dump options
  // ─────────────────────────────────────────────────────────────────────────
  var DUMP_OPTS = { indent: 2, lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false };

  // ─────────────────────────────────────────────────────────────────────────
  // Validate action
  // ─────────────────────────────────────────────────────────────────────────
  function validate() {
    var text = $('dcv-yaml-input').value.trim();
    if (!text) { showToast('⚠️ Nothing to validate'); return; }

    $('dcv-placeholder').classList.add('dcv-hidden');
    $('dcv-status-bar').classList.remove('dcv-hidden');

    var result = validateYaml(text);
    renderIssues(result.issues);

    if (result.doc) {
      try {
        var formatted = jsyaml.dump(result.doc, DUMP_OPTS);
        _fmtYaml = formatted;
        $('dcv-output').textContent = formatted;
        $('dcv-output-wrap').classList.remove('dcv-hidden');
      } catch (e) {
        $('dcv-output-wrap').classList.add('dcv-hidden');
      }
    } else {
      $('dcv-output-wrap').classList.add('dcv-hidden');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Format action
  // ─────────────────────────────────────────────────────────────────────────
  function format() {
    var text = $('dcv-yaml-input').value.trim();
    if (!text) { showToast('⚠️ Nothing to format'); return; }

    var doc;
    try {
      doc = jsyaml.load(text);
    } catch (e) {
      var line = (e.mark && e.mark.line != null) ? e.mark.line + 1 : '?';
      showToast('❌ YAML error at line ' + line);
      validate();
      return;
    }

    var formatted = jsyaml.dump(doc, DUMP_OPTS);
    _fmtYaml = formatted;
    $('dcv-placeholder').classList.add('dcv-hidden');
    $('dcv-output').textContent = formatted;
    $('dcv-output-wrap').classList.remove('dcv-hidden');
    showToast('🎨 Formatted!');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Example YAML (intentionally contains warnings for demo)
  // ─────────────────────────────────────────────────────────────────────────
  var EXAMPLE_YAML = [
    'version: "3.8"',
    '',
    'services:',
    '  web:',
    '    image: nginx:latest',
    '    ports:',
    '      - "80:80"',
    '    depends_on:',
    '      - db',
    '    environment:',
    '      - DB_HOST=db',
    '      - DB_PASSWORD=supersecret',
    '',
    '  db:',
    '    image: postgres',
    '    volumes:',
    '      - db_data:/var/lib/postgresql/data',
    '    environment:',
    '      POSTGRES_USER: admin',
    '      POSTGRES_PASSWORD: mysecretpassword',
    '      POSTGRES_DB: myapp',
    '',
    'volumes:',
    '  db_data:',
  ].join('\n');

  function loadExample() {
    $('dcv-yaml-input').value = EXAMPLE_YAML;
    updateLineCount();
    validate();
  }

  function clearInput() {
    $('dcv-yaml-input').value = '';
    updateLineCount();
    $('dcv-placeholder').classList.remove('dcv-hidden');
    $('dcv-status-bar').classList.add('dcv-hidden');
    $('dcv-issues').innerHTML = '';
    $('dcv-output-wrap').classList.add('dcv-hidden');
    $('dcv-cnt-error').textContent   = '0';
    $('dcv-cnt-warning').textContent = '0';
    $('dcv-cnt-hint').textContent    = '0';
    _allIssues = [];
    _fmtYaml   = '';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOKENIZER for docker run
  // ─────────────────────────────────────────────────────────────────────────
  function tokenize(cmd) {
    // Handle backslash line continuation
    cmd = cmd.replace(/\\\r?\n\s*/g, ' ').trim();
    var tokens = [];
    var i = 0;

    while (i < cmd.length) {
      while (i < cmd.length && /\s/.test(cmd[i])) i++;
      if (i >= cmd.length) break;

      var c = cmd[i], token = '';

      if (c === '"') {
        i++;
        while (i < cmd.length && cmd[i] !== '"') {
          if (cmd[i] === '\\' && i + 1 < cmd.length) { i++; token += cmd[i]; }
          else token += cmd[i];
          i++;
        }
        i++; // closing "
      } else if (c === "'") {
        i++;
        while (i < cmd.length && cmd[i] !== "'") { token += cmd[i]; i++; }
        i++; // closing '
      } else {
        while (i < cmd.length && !/\s/.test(cmd[i])) {
          if (cmd[i] === '\\' && i + 1 < cmd.length) { i++; token += cmd[i]; }
          else token += cmd[i];
          i++;
        }
      }

      if (token !== '') tokens.push(token);
    }
    return tokens;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOCKER RUN PARSER
  // ─────────────────────────────────────────────────────────────────────────
  // Flags that expect a value
  var VFLAGS = {
    '-p': 'port',     '--publish': 'port',
    '-v': 'volume',   '--volume': 'volume',     '--mount': 'mount',
    '-e': 'env',      '--env': 'env',
    '--env-file': 'env_file',
    '--name': 'name',
    '--hostname': 'hostname',
    '--network': 'network',  '--net': 'network',
    '--network-alias': 'net_alias',
    '--restart': 'restart',
    '-l': 'label',    '--label': 'label',
    '-m': 'memory',   '--memory': 'memory',
    '--memory-swap': 'memory_swap',
    '--cpus': 'cpus',
    '--cpu-shares': 'cpu_shares',
    '-u': 'user',     '--user': 'user',
    '--entrypoint': 'entrypoint',
    '-w': 'workdir',  '--workdir': 'workdir',
    '--add-host': 'extra_host',
    '--cap-add': 'cap_add',
    '--cap-drop': 'cap_drop',
    '--tmpfs': 'tmpfs',
    '--device': 'device',
    '--dns': 'dns',
    '--dns-search': 'dns_search',
    '--link': 'link',
    '--volumes-from': 'vols_from',
    '--log-driver': 'log_driver',
    '--log-opt': 'log_opt',
    '--health-cmd': 'h_cmd',
    '--health-interval': 'h_interval',
    '--health-retries': 'h_retries',
    '--health-timeout': 'h_timeout',
    '--health-start-period': 'h_start',
    '--platform': 'platform',
    '--stop-signal': 'stop_signal',
    '--stop-timeout': 'stop_timeout',
    '--ulimit': 'ulimit',
    '--shm-size': 'shm_size',
    '--security-opt': 'sec_opt',
    '--expose': 'expose',
    '--pid': 'pid',
    '--ipc': 'ipc',
    '--blkio-weight': 'blkio',
    '--mac-address': 'mac',
  };

  // Boolean flags
  var BFLAGS = {
    '-d': 'detach',   '--detach': 'detach',
    '-t': 'tty',      '--tty': 'tty',
    '-i': 'stdin',    '--interactive': 'stdin',
    '--privileged': 'privileged',
    '--read-only': 'read_only',
    '--rm': 'rm',
    '--init': 'init',
    '--no-healthcheck': 'no_hc',
  };

  function parseDockerRun(cmdText) {
    var tokens = tokenize(cmdText.trim());
    var warns  = [];

    // Skip "docker" and "run"
    var i = 0;
    if (tokens[i] && tokens[i].toLowerCase() === 'docker') i++;
    if (tokens[i] && tokens[i].toLowerCase() === 'run')    i++;

    var svc = {};
    var ports = [], volumes = [], envs = [], envFiles = [], labels = [];
    var capAdd = [], capDrop = [], extraHosts = [], tmpfs = [], devices = [];
    var dns = [], dnsSearch = [], links = [], volsFrom = [], secOpts = [], exposes = [];
    var logOpts = {}, ulimits = [], netAliases = [];
    var hc = {};
    var networkName = null;
    var image = null;
    var cmdArgs = [];

    while (i < tokens.length) {
      var tok = tokens[i];

      // Not a flag → image or command args
      if (tok.charAt(0) !== '-') {
        if (image === null) { image = tok; }
        else { cmdArgs.push(tok); }
        i++;
        continue;
      }

      // Expand combined short flags like -dit, -dp
      if (/^-[a-zA-Z]{2,}$/.test(tok)) {
        var chars    = tok.substring(1);
        var expanded = [];
        var canExp   = true;
        for (var ci = 0; ci < chars.length; ci++) {
          var sf = '-' + chars[ci];
          if (BFLAGS[sf] !== undefined) {
            expanded.push(sf);
          } else if (VFLAGS[sf] !== undefined && ci === chars.length - 1) {
            expanded.push(sf);
          } else {
            canExp = false; break;
          }
        }
        if (canExp && expanded.length > 0) {
          tokens.splice.apply(tokens, [i, 1].concat(expanded));
          continue; // reprocess
        }
      }

      // Parse flag (possibly --flag=value)
      var eq   = tok.indexOf('=');
      var flag, val;

      if (eq !== -1) {
        flag = tok.substring(0, eq);
        val  = tok.substring(eq + 1);
        i++;
      } else {
        flag = tok;
        i++;
        val  = null;
        // Consume next token as value if it's not a flag
        if (VFLAGS[flag] !== undefined && i < tokens.length && !/^-[a-zA-Z]/.test(tokens[i])) {
          val = tokens[i];
          i++;
        }
      }

      // Boolean flag
      if (BFLAGS[flag] !== undefined) {
        var bf = BFLAGS[flag];
        if      (bf === 'tty')        svc.tty        = true;
        else if (bf === 'stdin')      svc.stdin_open  = true;
        else if (bf === 'privileged') svc.privileged  = true;
        else if (bf === 'read_only')  svc.read_only   = true;
        else if (bf === 'init')       svc.init        = true;
        else if (bf === 'no_hc')      svc.healthcheck = { disable: true };
        else if (bf === 'rm')         warns.push('--rm: Compose manages container lifecycle — no equivalent. Removed.');
        // -d (detach) is default in Compose, skip
        continue;
      }

      // Value flag
      if (VFLAGS[flag] !== undefined) {
        if (val === null) {
          warns.push('Flag "' + flag + '" expects a value but none was found — skipped.');
          continue;
        }
        var vt = VFLAGS[flag];

        if      (vt === 'port')        ports.push(val);
        else if (vt === 'volume')      volumes.push(val);
        else if (vt === 'mount')       warns.push('--mount is not directly representable; converted to volumes entry: ' + val);
        else if (vt === 'env')         envs.push(val);
        else if (vt === 'env_file')    envFiles.push(val);
        else if (vt === 'name')        svc.container_name = val;
        else if (vt === 'hostname')    svc.hostname = val;
        else if (vt === 'network')     networkName = val;
        else if (vt === 'net_alias')   netAliases.push(val);
        else if (vt === 'restart')     svc.restart = val;
        else if (vt === 'label')       labels.push(val);
        else if (vt === 'memory')      setDeploy(svc, 'limits', 'memory', val);
        else if (vt === 'memory_swap') warns.push('--memory-swap has no direct Compose equivalent — skipped.');
        else if (vt === 'cpus')        setDeploy(svc, 'limits', 'cpus', val);
        else if (vt === 'cpu_shares')  warns.push('--cpu-shares: no direct Compose equivalent — skipped.');
        else if (vt === 'user')        svc.user = val;
        else if (vt === 'entrypoint')  svc.entrypoint = val;
        else if (vt === 'workdir')     svc.working_dir = val;
        else if (vt === 'extra_host')  extraHosts.push(val);
        else if (vt === 'cap_add')     capAdd.push(val);
        else if (vt === 'cap_drop')    capDrop.push(val);
        else if (vt === 'tmpfs')       tmpfs.push(val);
        else if (vt === 'device')      devices.push(val);
        else if (vt === 'dns')         dns.push(val);
        else if (vt === 'dns_search')  dnsSearch.push(val);
        else if (vt === 'link') {
          links.push(val);
          warns.push('"--link ' + val + '" is legacy/deprecated. Services on the same network reach each other by service name.');
        }
        else if (vt === 'vols_from')   volsFrom.push(val);
        else if (vt === 'log_driver') {
          if (!svc.logging) svc.logging = {};
          svc.logging.driver = val;
        }
        else if (vt === 'log_opt') {
          if (!svc.logging) svc.logging = {};
          if (!svc.logging.options) svc.logging.options = {};
          var kv = val.split('=');
          svc.logging.options[kv[0]] = kv.slice(1).join('=');
        }
        else if (vt === 'h_cmd')       hc.test     = ['CMD-SHELL', val];
        else if (vt === 'h_interval')  hc.interval = val;
        else if (vt === 'h_retries')   hc.retries  = parseInt(val, 10) || val;
        else if (vt === 'h_timeout')   hc.timeout  = val;
        else if (vt === 'h_start')     hc.start_period = val;
        else if (vt === 'platform')    svc.platform = val;
        else if (vt === 'stop_signal') svc.stop_signal = val;
        else if (vt === 'stop_timeout') svc.stop_grace_period = val + 's';
        else if (vt === 'shm_size')    svc.shm_size = val;
        else if (vt === 'sec_opt')     secOpts.push(val);
        else if (vt === 'expose')      exposes.push(val);
        else if (vt === 'pid')         svc.pid = val;
        else if (vt === 'ipc')         svc.ipc = val;
        else if (vt === 'blkio')       warns.push('--blkio-weight has no direct Compose equivalent — skipped.');
        else if (vt === 'mac')         svc.mac_address = val;
        else if (vt === 'ulimit') {
          if (!svc.ulimits) svc.ulimits = {};
          var up = val.split('=');
          var utype = up[0], uval = up[1] || '';
          if (uval.indexOf(':') !== -1) {
            var sv = uval.split(':');
            svc.ulimits[utype] = { soft: parseInt(sv[0], 10), hard: parseInt(sv[1], 10) };
          } else {
            svc.ulimits[utype] = parseInt(uval, 10) || uval;
          }
        }
        continue;
      }

      // Unknown flag
      warns.push('Unrecognized flag "' + flag + '" — skipped.');
    }

    if (image === null) {
      return { error: 'No image found. Make sure the image name appears after all flags.' };
    }

    // ── Assemble service ───────────────────────────────────────────────────
    svc.image = image;

    if (ports.length)      svc.ports       = ports;
    if (volumes.length)    svc.volumes     = volumes;
    if (envs.length)       svc.environment = envs;
    if (envFiles.length)   svc.env_file    = envFiles.length === 1 ? envFiles[0] : envFiles;
    if (labels.length)     svc.labels      = labels;
    if (extraHosts.length) svc.extra_hosts = extraHosts;
    if (capAdd.length)     svc.cap_add     = capAdd;
    if (capDrop.length)    svc.cap_drop    = capDrop;
    if (tmpfs.length)      svc.tmpfs       = tmpfs.length === 1 ? tmpfs[0] : tmpfs;
    if (devices.length)    svc.devices     = devices;
    if (dns.length)        svc.dns         = dns;
    if (dnsSearch.length)  svc.dns_search  = dnsSearch;
    if (links.length)      svc.links       = links;
    if (volsFrom.length)   svc.volumes_from = volsFrom;
    if (secOpts.length)    svc.security_opt = secOpts;
    if (exposes.length)    svc.expose       = exposes;

    if (Object.keys(hc).length > 0 && !svc.healthcheck) svc.healthcheck = hc;

    if (cmdArgs.length === 1)    svc.command = cmdArgs[0];
    else if (cmdArgs.length > 1) svc.command = cmdArgs;

    // Network
    var topNets = null;
    if (networkName) {
      if      (networkName === 'host')   { svc.network_mode = 'host'; }
      else if (networkName === 'none')   { svc.network_mode = 'none'; }
      else if (networkName !== 'bridge') {
        if (netAliases.length) {
          svc.networks = {};
          svc.networks[networkName] = { aliases: netAliases };
        } else {
          svc.networks = [networkName];
        }
        topNets = {};
        topNets[networkName] = { external: true };
      }
    }

    // Service name
    var svcName = svc.container_name
      ? svc.container_name.replace(/[^a-z0-9_-]/gi, '_')
      : image.split(':')[0].split('/').pop().replace(/[^a-z0-9_-]/gi, '_');

    var compose = { services: {} };
    compose.services[svcName] = svc;
    if (topNets) compose.networks = topNets;

    return { compose: compose, warnings: warns, serviceName: svcName };
  }

  // Helper: safely set deploy.resources.limits.key
  function setDeploy(svc, branch, key, val) {
    if (!svc.deploy) svc.deploy = {};
    if (!svc.deploy.resources) svc.deploy.resources = {};
    if (!svc.deploy.resources[branch]) svc.deploy.resources[branch] = {};
    svc.deploy.resources[branch][key] = val;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Convert action
  // ─────────────────────────────────────────────────────────────────────────
  function convert() {
    var cmd = $('dcv-run-input').value.trim();
    if (!cmd) { showToast('⚠️ Nothing to convert'); return; }

    var result = parseDockerRun(cmd);
    var warnsEl = $('dcv-run-warns');
    warnsEl.innerHTML = '';
    $('dcv-run-placeholder').classList.add('dcv-hidden');

    if (result.error) {
      var errDiv = document.createElement('div');
      errDiv.className = 'dcv-run-warn dcv-run-error';
      errDiv.textContent = '❌ ' + result.error;
      warnsEl.appendChild(errDiv);
      warnsEl.classList.remove('dcv-hidden');
      $('dcv-run-output-wrap').classList.add('dcv-hidden');
      return;
    }

    if (result.warnings && result.warnings.length > 0) {
      result.warnings.forEach(function (w) {
        var d = document.createElement('div');
        d.className = 'dcv-run-warn';
        d.textContent = '⚠️ ' + w;
        warnsEl.appendChild(d);
      });
      warnsEl.classList.remove('dcv-hidden');
    } else {
      warnsEl.classList.add('dcv-hidden');
    }

    var yaml = jsyaml.dump(result.compose, DUMP_OPTS);
    _convertYaml = yaml;
    $('dcv-run-output').textContent = yaml;
    $('dcv-run-output-wrap').classList.remove('dcv-hidden');
  }

  // Example docker run (Immich — relevant to homelab)
  var EXAMPLE_RUN = [
    'docker run -d \\',
    '  --name immich_server \\',
    '  -p 2283:2283 \\',
    '  -v /mnt/media/immich:/usr/src/app/upload \\',
    '  -v /etc/localtime:/etc/localtime:ro \\',
    '  -e DB_HOSTNAME=immich_postgres \\',
    '  -e DB_USERNAME=postgres \\',
    '  -e DB_PASSWORD=mysecretpassword \\',
    '  -e REDIS_HOSTNAME=immich_redis \\',
    '  --restart=unless-stopped \\',
    '  --memory=2g \\',
    '  --cpus=2 \\',
    '  --health-cmd="curl -f http://localhost:2283/api/server/ping || exit 1" \\',
    '  --health-interval=30s \\',
    '  --health-retries=5 \\',
    '  --health-start-period=60s \\',
    '  --log-driver=json-file \\',
    '  --log-opt max-size=10m \\',
    '  --log-opt max-file=3 \\',
    '  ghcr.io/immich-app/immich-server:release',
  ].join('\n');

  function runExample() {
    $('dcv-run-input').value = EXAMPLE_RUN;
    convert();
  }

  function clearRun() {
    $('dcv-run-input').value = '';
    $('dcv-run-placeholder').classList.remove('dcv-hidden');
    $('dcv-run-output-wrap').classList.add('dcv-hidden');
    $('dcv-run-warns').classList.add('dcv-hidden');
    _convertYaml = '';
  }

  // Send converted YAML to the validator tab
  function sendToValidator() {
    if (!_convertYaml) return;
    $('dcv-yaml-input').value = _convertYaml;
    switchTab('validate');
    updateLineCount();
    validate();
    showToast('✅ Sent to validator!');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Keyboard support
  // ─────────────────────────────────────────────────────────────────────────
  function initKeyboard() {
    var yamlIn = $('dcv-yaml-input');
    var runIn  = $('dcv-run-input');

    // Main editor
    yamlIn.addEventListener('keydown', function (e) {
      // Ctrl/Cmd + Enter → Validate
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); validate(); return; }
      // Tab → insert 2 spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        var s = yamlIn.selectionStart, end = yamlIn.selectionEnd;
        yamlIn.value = yamlIn.value.substring(0, s) + '  ' + yamlIn.value.substring(end);
        yamlIn.selectionStart = yamlIn.selectionEnd = s + 2;
      }
    });
    yamlIn.addEventListener('input', updateLineCount);
    yamlIn.addEventListener('paste', function () { setTimeout(updateLineCount, 0); });

    // Run input
    runIn.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); convert(); }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────────────────────────────────
  function init() {
    initKeyboard();
    // Set initial chip states
    updateChips();
    // Error and warning chips start active (checkboxes start checked in HTML)
  }

  document.addEventListener('DOMContentLoaded', init);

  // ─────────────────────────────────────────────────────────────────────────
  // Expose globals (for onclick handlers)
  // ─────────────────────────────────────────────────────────────────────────
  window.dcvSwitchTab       = switchTab;
  window.dcvValidate        = validate;
  window.dcvFormat          = format;
  window.dcvLoadExample     = loadExample;
  window.dcvClear           = clearInput;
  window.dcvCopyOutput      = function () { copyText(_fmtYaml, 'YAML copied!'); };
  window.dcvDownloadOutput  = function () { download('docker-compose.yml', _fmtYaml); };
  window.dcvApplyFilter     = applyFilter;
  window.dcvConvert         = convert;
  window.dcvRunExample      = runExample;
  window.dcvClearRun        = clearRun;
  window.dcvCopyRun         = function () { copyText(_convertYaml, 'YAML copied!'); };
  window.dcvDownloadRun     = function () { download('docker-compose.yml', _convertYaml); };
  window.dcvSendToValidator = sendToValidator;

})();
