// Dependencies: js-yaml 4.1.0 (MIT) — loaded via <script> in index.html
// Namespace prefix: drc-

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var _dir = 'run2compose'; // or 'compose2run'
  var _output = '';

  var DUMP_OPTS = { indent: 2, lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false };

  // ───────────────────────────────────────────────────────────────────────
  // Toast / clipboard / download
  // ───────────────────────────────────────────────────────────────────────
  function showToast(msg) {
    var t = $('drc-toast');
    t.textContent = msg || '✅ Done';
    t.classList.add('drc-show');
    setTimeout(function () { t.classList.remove('drc-show'); }, 2200);
  }

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

  function download(filename, content) {
    if (!content) { showToast('⚠️ Nothing to download'); return; }
    var a = document.createElement('a');
    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function lineCount(text) {
    return text ? text.split('\n').length : 0;
  }

  function updateCounts() {
    $('drc-input-count').textContent = lineCount($('drc-input').value) + ' line' + (lineCount($('drc-input').value) !== 1 ? 's' : '');
    $('drc-output-count').textContent = lineCount($('drc-output').value) + ' line' + (lineCount($('drc-output').value) !== 1 ? 's' : '');
  }

  function showWarnings(list) {
    var el = $('drc-warnings');
    el.innerHTML = '';
    if (!list || list.length === 0) {
      el.classList.add('drc-hidden');
      return;
    }
    list.forEach(function (w) {
      var d = document.createElement('div');
      d.className = 'drc-warn' + (w.error ? ' drc-warn--error' : '');
      d.textContent = (w.error ? '❌ ' : '⚠️ ') + w.message;
      el.appendChild(d);
    });
    el.classList.remove('drc-hidden');
  }

  // ───────────────────────────────────────────────────────────────────────
  // TOKENIZER for docker run
  // ───────────────────────────────────────────────────────────────────────
  function tokenize(cmd) {
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
        i++;
      } else if (c === "'") {
        i++;
        while (i < cmd.length && cmd[i] !== "'") { token += cmd[i]; i++; }
        i++;
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

  // ───────────────────────────────────────────────────────────────────────
  // DOCKER RUN → COMPOSE
  // ───────────────────────────────────────────────────────────────────────
  var VFLAGS = {
    '-p': 'port', '--publish': 'port',
    '-v': 'volume', '--volume': 'volume', '--mount': 'mount',
    '-e': 'env', '--env': 'env',
    '--env-file': 'env_file',
    '--name': 'name',
    '--hostname': 'hostname',
    '--network': 'network', '--net': 'network',
    '--network-alias': 'net_alias',
    '--restart': 'restart',
    '-l': 'label', '--label': 'label',
    '-m': 'memory', '--memory': 'memory',
    '--memory-swap': 'memory_swap',
    '--cpus': 'cpus',
    '--cpu-shares': 'cpu_shares',
    '-u': 'user', '--user': 'user',
    '--entrypoint': 'entrypoint',
    '-w': 'workdir', '--workdir': 'workdir',
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

  var BFLAGS = {
    '-d': 'detach', '--detach': 'detach',
    '-t': 'tty', '--tty': 'tty',
    '-i': 'stdin', '--interactive': 'stdin',
    '--privileged': 'privileged',
    '--read-only': 'read_only',
    '--rm': 'rm',
    '--init': 'init',
    '--no-healthcheck': 'no_hc',
  };

  function setDeploy(svc, branch, key, val) {
    if (!svc.deploy) svc.deploy = {};
    if (!svc.deploy.resources) svc.deploy.resources = {};
    if (!svc.deploy.resources[branch]) svc.deploy.resources[branch] = {};
    svc.deploy.resources[branch][key] = val;
  }

  function parseDockerRun(cmdText) {
    var tokens = tokenize(cmdText.trim());
    var warns = [];

    var i = 0;
    if (tokens[i] && tokens[i].toLowerCase() === 'docker') i++;
    if (tokens[i] && tokens[i].toLowerCase() === 'run') i++;

    var svc = {};
    var ports = [], volumes = [], envs = [], envFiles = [], labels = [];
    var capAdd = [], capDrop = [], extraHosts = [], tmpfs = [], devices = [];
    var dns = [], dnsSearch = [], links = [], volsFrom = [], secOpts = [], exposes = [];
    var ulimits = [], netAliases = [];
    var hc = {};
    var networkName = null;
    var image = null;
    var cmdArgs = [];

    while (i < tokens.length) {
      var tok = tokens[i];

      if (tok.charAt(0) !== '-') {
        if (image === null) { image = tok; }
        else { cmdArgs.push(tok); }
        i++;
        continue;
      }

      if (/^-[a-zA-Z]{2,}$/.test(tok)) {
        var chars = tok.substring(1);
        var expanded = [];
        var canExp = true;
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
          continue;
        }
      }

      var eq = tok.indexOf('=');
      var flag, val;

      if (eq !== -1 && tok.charAt(0) === '-' && tok.charAt(1) === '-') {
        flag = tok.substring(0, eq);
        val = tok.substring(eq + 1);
        i++;
      } else {
        flag = tok;
        i++;
        val = null;
        if (VFLAGS[flag] !== undefined && i < tokens.length && !/^-[a-zA-Z]/.test(tokens[i])) {
          val = tokens[i];
          i++;
        }
      }

      if (BFLAGS[flag] !== undefined) {
        var bf = BFLAGS[flag];
        if (bf === 'tty') svc.tty = true;
        else if (bf === 'stdin') svc.stdin_open = true;
        else if (bf === 'privileged') svc.privileged = true;
        else if (bf === 'read_only') svc.read_only = true;
        else if (bf === 'init') svc.init = true;
        else if (bf === 'no_hc') svc.healthcheck = { disable: true };
        else if (bf === 'rm') warns.push({ message: '--rm: Compose manages container lifecycle — no equivalent. Removed.' });
        continue;
      }

      if (VFLAGS[flag] !== undefined) {
        if (val === null) {
          warns.push({ message: 'Flag "' + flag + '" expects a value but none was found — skipped.' });
          continue;
        }
        var vt = VFLAGS[flag];

        if (vt === 'port') ports.push(val);
        else if (vt === 'volume') volumes.push(val);
        else if (vt === 'mount') warns.push({ message: '--mount is not directly representable; converted to a volumes entry: ' + val });
        else if (vt === 'env') envs.push(val);
        else if (vt === 'env_file') envFiles.push(val);
        else if (vt === 'name') svc.container_name = val;
        else if (vt === 'hostname') svc.hostname = val;
        else if (vt === 'network') networkName = val;
        else if (vt === 'net_alias') netAliases.push(val);
        else if (vt === 'restart') svc.restart = val;
        else if (vt === 'label') labels.push(val);
        else if (vt === 'memory') setDeploy(svc, 'limits', 'memory', val);
        else if (vt === 'memory_swap') warns.push({ message: '--memory-swap has no direct Compose equivalent — skipped.' });
        else if (vt === 'cpus') setDeploy(svc, 'limits', 'cpus', val);
        else if (vt === 'cpu_shares') warns.push({ message: '--cpu-shares has no direct Compose equivalent — skipped.' });
        else if (vt === 'user') svc.user = val;
        else if (vt === 'entrypoint') svc.entrypoint = val;
        else if (vt === 'workdir') svc.working_dir = val;
        else if (vt === 'extra_host') extraHosts.push(val);
        else if (vt === 'cap_add') capAdd.push(val);
        else if (vt === 'cap_drop') capDrop.push(val);
        else if (vt === 'tmpfs') tmpfs.push(val);
        else if (vt === 'device') devices.push(val);
        else if (vt === 'dns') dns.push(val);
        else if (vt === 'dns_search') dnsSearch.push(val);
        else if (vt === 'link') {
          links.push(val);
          warns.push({ message: '"--link ' + val + '" is legacy/deprecated. Services on the same network reach each other by service name.' });
        }
        else if (vt === 'vols_from') volsFrom.push(val);
        else if (vt === 'log_driver') { if (!svc.logging) svc.logging = {}; svc.logging.driver = val; }
        else if (vt === 'log_opt') {
          if (!svc.logging) svc.logging = {};
          if (!svc.logging.options) svc.logging.options = {};
          var kv = val.split('=');
          svc.logging.options[kv[0]] = kv.slice(1).join('=');
        }
        else if (vt === 'h_cmd') hc.test = ['CMD-SHELL', val];
        else if (vt === 'h_interval') hc.interval = val;
        else if (vt === 'h_retries') hc.retries = parseInt(val, 10) || val;
        else if (vt === 'h_timeout') hc.timeout = val;
        else if (vt === 'h_start') hc.start_period = val;
        else if (vt === 'platform') svc.platform = val;
        else if (vt === 'stop_signal') svc.stop_signal = val;
        else if (vt === 'stop_timeout') svc.stop_grace_period = val + 's';
        else if (vt === 'shm_size') svc.shm_size = val;
        else if (vt === 'sec_opt') secOpts.push(val);
        else if (vt === 'expose') exposes.push(val);
        else if (vt === 'pid') svc.pid = val;
        else if (vt === 'ipc') svc.ipc = val;
        else if (vt === 'blkio') warns.push({ message: '--blkio-weight has no direct Compose equivalent — skipped.' });
        else if (vt === 'mac') svc.mac_address = val;
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

      warns.push({ message: 'Unrecognized flag "' + flag + '" — skipped.' });
    }

    if (image === null) {
      return { error: 'No image found. Make sure the image name appears after all flags.' };
    }

    svc.image = image;

    if (ports.length) svc.ports = ports;
    if (volumes.length) svc.volumes = volumes;
    if (envs.length) svc.environment = envs;
    if (envFiles.length) svc.env_file = envFiles.length === 1 ? envFiles[0] : envFiles;
    if (labels.length) svc.labels = labels;
    if (extraHosts.length) svc.extra_hosts = extraHosts;
    if (capAdd.length) svc.cap_add = capAdd;
    if (capDrop.length) svc.cap_drop = capDrop;
    if (tmpfs.length) svc.tmpfs = tmpfs.length === 1 ? tmpfs[0] : tmpfs;
    if (devices.length) svc.devices = devices;
    if (dns.length) svc.dns = dns;
    if (dnsSearch.length) svc.dns_search = dnsSearch;
    if (links.length) svc.links = links;
    if (volsFrom.length) svc.volumes_from = volsFrom;
    if (secOpts.length) svc.security_opt = secOpts;
    if (exposes.length) svc.expose = exposes;

    if (Object.keys(hc).length > 0 && !svc.healthcheck) svc.healthcheck = hc;

    if (cmdArgs.length === 1) svc.command = cmdArgs[0];
    else if (cmdArgs.length > 1) svc.command = cmdArgs;

    var topNets = null;
    if (networkName) {
      if (networkName === 'host') { svc.network_mode = 'host'; }
      else if (networkName === 'none') { svc.network_mode = 'none'; }
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

    var svcName = svc.container_name
      ? svc.container_name.replace(/[^a-z0-9_-]/gi, '_')
      : image.split(':')[0].split('/').pop().replace(/[^a-z0-9_-]/gi, '_');

    var compose = { services: {} };
    compose.services[svcName] = svc;
    if (topNets) compose.networks = topNets;

    return { compose: compose, warnings: warns, serviceName: svcName };
  }

  // Splits input into one or more docker run commands, separated by blank
  // lines. Lines starting with "#" (e.g. the "# service: name" markers this
  // tool emits) are treated as comments and stripped.
  function splitRunCommands(text) {
    var blocks = text.split(/\n\s*\n/);
    var cmds = [];
    blocks.forEach(function (block) {
      var lines = block.split('\n').filter(function (l) { return !/^\s*#/.test(l); });
      var cmd = lines.join('\n').trim();
      if (cmd) cmds.push(cmd);
    });
    return cmds;
  }

  function runToCompose(cmdText) {
    if (!cmdText.trim()) return { error: 'Paste a docker run command first.' };

    var cmds = splitRunCommands(cmdText);
    if (cmds.length === 0) return { error: 'Paste a docker run command first.' };

    var compose = { services: {} };
    var topNets = {};
    var allWarns = [];
    var usedNames = {};

    for (var idx = 0; idx < cmds.length; idx++) {
      var result = parseDockerRun(cmds[idx]);
      if (result.error) {
        return cmds.length === 1 ? { error: result.error } : { error: 'Command ' + (idx + 1) + ': ' + result.error };
      }

      var svcName = result.serviceName;
      if (usedNames[svcName]) {
        var n = 2;
        while (usedNames[svcName + '_' + n]) n++;
        svcName = svcName + '_' + n;
      }
      usedNames[svcName] = true;

      compose.services[svcName] = result.compose.services[result.serviceName];
      if (result.compose.networks) {
        Object.keys(result.compose.networks).forEach(function (k) { topNets[k] = result.compose.networks[k]; });
      }
      (result.warnings || []).forEach(function (w) {
        allWarns.push({ error: w.error, message: (cmds.length > 1 ? 'Command ' + (idx + 1) + ' (' + svcName + '): ' : '') + w.message });
      });
    }

    if (Object.keys(topNets).length) compose.networks = topNets;

    var yaml = jsyaml.dump(compose, DUMP_OPTS);
    return { output: yaml, warnings: allWarns };
  }

  // ───────────────────────────────────────────────────────────────────────
  // COMPOSE → DOCKER RUN
  // ───────────────────────────────────────────────────────────────────────
  function shellQuote(val) {
    var s = String(val);
    if (s === '') return "''";
    if (/^[a-zA-Z0-9_.\-/:=,@%]+$/.test(s)) return s;
    if (s.indexOf("'") === -1) return "'" + s + "'";
    return '"' + s.replace(/(["$`\\])/g, '\\$1') + '"';
  }

  function toKeyValList(field) {
    // field may be an array of "K=V" strings or an object map
    var out = [];
    if (!field) return out;
    if (Array.isArray(field)) {
      field.forEach(function (item) { out.push(String(item)); });
    } else if (typeof field === 'object') {
      Object.keys(field).forEach(function (k) {
        out.push(k + '=' + field[k]);
      });
    }
    return out;
  }

  function toList(field) {
    if (!field) return [];
    return Array.isArray(field) ? field : [field];
  }

  function buildRunForService(name, svc, warns) {
    var parts = ['docker', 'run', '-d'];

    var cname = svc.container_name || name;
    parts.push('--name', shellQuote(cname));

    if (svc.hostname) parts.push('--hostname', shellQuote(svc.hostname));

    if (svc.network_mode) {
      parts.push('--network', shellQuote(svc.network_mode));
    } else if (svc.networks) {
      var nets = Array.isArray(svc.networks) ? svc.networks : Object.keys(svc.networks);
      if (nets.length) {
        parts.push('--network', shellQuote(nets[0]));
        if (nets.length > 1) {
          warns.push({ message: 'Service "' + name + '" joins multiple networks (' + nets.join(', ') + '). docker run only accepts one network at creation — connect the rest afterwards with `docker network connect`.' });
        }
      }
    }

    if (svc.restart) parts.push('--restart', shellQuote(svc.restart));

    toList(svc.ports).forEach(function (p) {
      if (typeof p === 'object' && p !== null) {
        var seg = (p.host_ip ? p.host_ip + ':' : '') + (p.published != null ? p.published + ':' : '') + p.target + (p.protocol ? '/' + p.protocol : '');
        parts.push('-p', shellQuote(seg));
      } else {
        parts.push('-p', shellQuote(p));
      }
    });

    toList(svc.expose).forEach(function (e) { parts.push('--expose', shellQuote(e)); });

    toList(svc.volumes).forEach(function (v) {
      if (typeof v === 'object' && v !== null) {
        var seg = (v.source ? v.source + ':' : '') + v.target + (v.read_only ? ':ro' : '');
        parts.push('-v', shellQuote(seg));
      } else {
        parts.push('-v', shellQuote(v));
      }
    });

    toKeyValList(svc.environment).forEach(function (e) { parts.push('-e', shellQuote(e)); });
    toList(svc.env_file).forEach(function (f) { parts.push('--env-file', shellQuote(f)); });
    toKeyValList(svc.labels).forEach(function (l) { parts.push('--label', shellQuote(l)); });
    toList(svc.cap_add).forEach(function (c) { parts.push('--cap-add', shellQuote(c)); });
    toList(svc.cap_drop).forEach(function (c) { parts.push('--cap-drop', shellQuote(c)); });
    toList(svc.devices).forEach(function (d) { parts.push('--device', shellQuote(d)); });
    toList(svc.dns).forEach(function (d) { parts.push('--dns', shellQuote(d)); });
    toList(svc.dns_search).forEach(function (d) { parts.push('--dns-search', shellQuote(d)); });
    toList(svc.extra_hosts).forEach(function (h) { parts.push('--add-host', shellQuote(h)); });
    toList(svc.security_opt).forEach(function (s) { parts.push('--security-opt', shellQuote(s)); });

    if (svc.privileged) parts.push('--privileged');
    if (svc.read_only) parts.push('--read-only');
    if (svc.init) parts.push('--init');
    if (svc.tty) parts.push('-t');
    if (svc.stdin_open) parts.push('-i');
    if (svc.user) parts.push('-u', shellQuote(svc.user));
    if (svc.working_dir) parts.push('-w', shellQuote(svc.working_dir));

    if (svc.entrypoint) {
      var ep = Array.isArray(svc.entrypoint) ? svc.entrypoint : [svc.entrypoint];
      if (ep.length > 1) warns.push({ message: 'Service "' + name + '" has a multi-part entrypoint; docker run --entrypoint only accepts a single executable — extra args moved into the command.' });
      parts.push('--entrypoint', shellQuote(ep[0]));
    }

    if (svc.shm_size) parts.push('--shm-size', shellQuote(svc.shm_size));
    if (svc.pid) parts.push('--pid', shellQuote(svc.pid));
    if (svc.ipc) parts.push('--ipc', shellQuote(svc.ipc));
    if (svc.mac_address) parts.push('--mac-address', shellQuote(svc.mac_address));
    if (svc.stop_signal) parts.push('--stop-signal', shellQuote(svc.stop_signal));
    if (svc.stop_grace_period) parts.push('--stop-timeout', shellQuote(String(svc.stop_grace_period).replace(/s$/, '')));
    if (svc.platform) parts.push('--platform', shellQuote(svc.platform));

    if (svc.ulimits && typeof svc.ulimits === 'object') {
      Object.keys(svc.ulimits).forEach(function (k) {
        var u = svc.ulimits[k];
        if (u && typeof u === 'object') parts.push('--ulimit', shellQuote(k + '=' + u.soft + ':' + u.hard));
        else parts.push('--ulimit', shellQuote(k + '=' + u));
      });
    }

    if (svc.logging) {
      if (svc.logging.driver) parts.push('--log-driver', shellQuote(svc.logging.driver));
      if (svc.logging.options) {
        Object.keys(svc.logging.options).forEach(function (k) {
          parts.push('--log-opt', shellQuote(k + '=' + svc.logging.options[k]));
        });
      }
    }

    if (svc.healthcheck) {
      var h = svc.healthcheck;
      if (h.disable) {
        parts.push('--no-healthcheck');
      } else {
        if (h.test) {
          var testArr = Array.isArray(h.test) ? h.test : [h.test];
          var cmdStr = testArr[0] === 'CMD-SHELL' || testArr[0] === 'CMD' ? testArr.slice(1).join(' ') : testArr.join(' ');
          parts.push('--health-cmd', shellQuote(cmdStr));
        }
        if (h.interval) parts.push('--health-interval', shellQuote(h.interval));
        if (h.retries) parts.push('--health-retries', shellQuote(String(h.retries)));
        if (h.timeout) parts.push('--health-timeout', shellQuote(h.timeout));
        if (h.start_period) parts.push('--health-start-period', shellQuote(h.start_period));
      }
    }

    if (svc.deploy && svc.deploy.resources && svc.deploy.resources.limits) {
      var lim = svc.deploy.resources.limits;
      if (lim.cpus) parts.push('--cpus', shellQuote(String(lim.cpus)));
      if (lim.memory) parts.push('--memory', shellQuote(String(lim.memory)));
    }

    if (svc.depends_on) {
      var deps = Array.isArray(svc.depends_on) ? svc.depends_on : Object.keys(svc.depends_on);
      warns.push({ message: 'Service "' + name + '" depends on: ' + deps.join(', ') + '. docker run has no startup ordering — start dependencies first, manually.' });
    }

    var image = svc.image;
    if (!image && svc.build) {
      warns.push({ message: 'Service "' + name + '" uses "build" instead of "image". Build it first (`docker build -t ' + name + ' <context>`) and reference that tag.' });
      image = name + ':latest';
    }
    if (!image) {
      warns.push({ error: true, message: 'Service "' + name + '" has no "image" or "build" — skipped.' });
      return null;
    }
    parts.push(shellQuote(image));

    if (svc.command) {
      var cmd = Array.isArray(svc.command) ? svc.command : tokenize(String(svc.command));
      cmd.forEach(function (c) { parts.push(shellQuote(c)); });
    }

    // Pretty-print with line continuations, one flag pair per line.
    var lines = [parts[0] + ' ' + parts[1] + ' ' + parts[2] + ' \\'];
    var i = 3;
    while (i < parts.length) {
      var isFlag = parts[i].charAt(0) === '-';
      var chunk;
      if (isFlag && i + 1 < parts.length && parts[i + 1].charAt(0) !== '-') {
        chunk = '  ' + parts[i] + ' ' + parts[i + 1];
        i += 2;
      } else {
        chunk = '  ' + parts[i];
        i += 1;
      }
      var isLast = i >= parts.length;
      lines.push(chunk + (isLast ? '' : ' \\'));
    }

    return lines.join('\n');
  }

  function composeToRun(yamlText) {
    if (!yamlText.trim()) return { error: 'Paste a docker-compose.yml file first.' };
    var doc;
    try {
      doc = jsyaml.load(yamlText);
    } catch (e) {
      var msg = (e.reason || e.message || String(e)).replace(/\s+at line.*$/i, '').trim();
      return { error: 'YAML syntax error: ' + msg };
    }
    if (!doc || typeof doc !== 'object' || !doc.services || typeof doc.services !== 'object') {
      return { error: 'No "services" mapping found at the top level of this Compose file.' };
    }

    var names = Object.keys(doc.services);
    if (names.length === 0) return { error: '"services" is empty — nothing to convert.' };

    var warns = [];
    var blocks = [];
    names.forEach(function (name) {
      var svc = doc.services[name] || {};
      var run = buildRunForService(name, svc, warns);
      if (run) {
        blocks.push((names.length > 1 ? '# service: ' + name + '\n' : '') + run);
      }
    });

    if (blocks.length === 0) return { error: 'No service could be converted (see warnings).', warnings: warns };

    return { output: blocks.join('\n\n'), warnings: warns };
  }

  // ───────────────────────────────────────────────────────────────────────
  // UI wiring
  // ───────────────────────────────────────────────────────────────────────
  var EXAMPLE_RUN = [
    'docker run -d \\',
    '  --name webapp \\',
    '  -p 8080:80 \\',
    '  -v webapp_data:/usr/share/nginx/html \\',
    '  -e NODE_ENV=production \\',
    '  --restart unless-stopped \\',
    '  --memory=512m \\',
    '  --cpus=1 \\',
    '  nginx:1.27-alpine',
  ].join('\n');

  var EXAMPLE_COMPOSE = [
    'services:',
    '  web:',
    '    image: nginx:1.27-alpine',
    '    container_name: webapp',
    '    ports:',
    '      - "8080:80"',
    '    volumes:',
    '      - webapp_data:/usr/share/nginx/html',
    '    environment:',
    '      - NODE_ENV=production',
    '    restart: unless-stopped',
    '    depends_on:',
    '      - db',
    '  db:',
    '    image: postgres:16-alpine',
    '    environment:',
    '      POSTGRES_PASSWORD: example',
    '    volumes:',
    '      - db_data:/var/lib/postgresql/data',
    '    restart: unless-stopped',
    '',
    'volumes:',
    '  webapp_data:',
    '  db_data:',
  ].join('\n');

  function labelsFor(dir) {
    return dir === 'run2compose'
      ? { input: 'docker run command', output: 'docker-compose.yml', inputPh: 'docker run -d --name webapp -p 8080:80 -e NODE_ENV=production nginx:1.27-alpine', outputPh: 'Converted docker-compose.yml will appear here.', file: 'docker-compose.yml' }
      : { input: 'docker-compose.yml', output: 'docker run command(s)', inputPh: 'services:\n  web:\n    image: nginx:latest\n    ports:\n      - "8080:80"', outputPh: 'Converted docker run command(s) will appear here.', file: 'docker-run.sh' };
  }

  function updateUiForDirection() {
    var l = labelsFor(_dir);
    $('drc-input-label').textContent = l.input;
    $('drc-output-label').textContent = l.output;
    $('drc-input').placeholder = l.inputPh;
    $('drc-output').placeholder = l.outputPh;

    $('drc-dir-run2compose').classList.toggle('drc-toggle-btn--active', _dir === 'run2compose');
    $('drc-dir-run2compose').setAttribute('aria-selected', _dir === 'run2compose');
    $('drc-dir-compose2run').classList.toggle('drc-toggle-btn--active', _dir === 'compose2run');
    $('drc-dir-compose2run').setAttribute('aria-selected', _dir === 'compose2run');
  }

  function setDirection(dir) {
    _dir = dir;
    updateUiForDirection();
    showWarnings(null);
  }

  function convert() {
    var input = $('drc-input').value;
    var result = _dir === 'run2compose' ? runToCompose(input) : composeToRun(input);

    if (result.error) {
      showWarnings([{ error: true, message: result.error }]);
      $('drc-output').value = '';
      _output = '';
      updateCounts();
      return;
    }

    showWarnings(result.warnings);
    $('drc-output').value = result.output;
    _output = result.output;
    updateCounts();
  }

  function loadExample() {
    $('drc-input').value = _dir === 'run2compose' ? EXAMPLE_RUN : EXAMPLE_COMPOSE;
    updateCounts();
    convert();
  }

  function clearAll() {
    $('drc-input').value = '';
    $('drc-output').value = '';
    _output = '';
    showWarnings(null);
    updateCounts();
  }

  function swap() {
    var out = $('drc-output').value;
    var newDir = _dir === 'run2compose' ? 'compose2run' : 'run2compose';
    setDirection(newDir);
    if (out.trim()) {
      $('drc-input').value = out;
      updateCounts();
      convert();
    } else {
      updateCounts();
    }
  }

  function initKeyboard() {
    $('drc-input').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); convert(); }
    });
    $('drc-input').addEventListener('input', updateCounts);
    $('drc-input').addEventListener('paste', function () { setTimeout(updateCounts, 0); });
  }

  function init() {
    updateUiForDirection();
    initKeyboard();
    updateCounts();
  }

  document.addEventListener('DOMContentLoaded', init);

  window.drcSetDirection = setDirection;
  window.drcConvert = convert;
  window.drcLoadExample = loadExample;
  window.drcClear = clearAll;
  window.drcSwap = swap;
  window.drcCopyOutput = function () { copyText(_output, 'Copied!'); };
  window.drcDownloadOutput = function () { download(labelsFor(_dir).file, _output); };
})();
