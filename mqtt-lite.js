// Minimal MQTT 3.1.1 client over WebSocket (QoS 0 only) – enough to pass messages between the phone and the TV.
// Written in plain ES2015 so it also runs in older Samsung TV browsers. Tries the brokers in order and reconnects.
(function (global) {
  var BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
  var enc = new TextEncoder(), dec = new TextDecoder();

  function str(s) { var b = enc.encode(s); return [b.length >> 8, b.length & 255].concat(Array.from(b)); }
  function packet(type, body) {
    var len = body.length, head = [type];
    do { var d = len % 128; len = Math.floor(len / 128); head.push(len > 0 ? d | 128 : d); } while (len > 0);
    return new Uint8Array(head.concat(body));
  }

  function Client(opts) {
    this.opts = opts;            // { onMessage(topic, text), onState(state) }
    this.subs = [];
    this.brokerIndex = 0;
    this.retry = 1000;
    this.connected = false;
    this.buf = new Uint8Array(0);
    this.nextId = 1;
    this.open();
  }
  Client.prototype.state = function (s) { if (this.opts.onState) this.opts.onState(s); };
  Client.prototype.open = function () {
    var self = this, url = BROKERS[this.brokerIndex % BROKERS.length];
    this.state('connecting');
    var ws;
    try { ws = new WebSocket(url, 'mqtt'); } catch (e) { return this.later(); }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = function () {
      var id = 'badukcast-' + Math.random().toString(36).slice(2, 10);
      // CONNECT: protocol "MQTT" level 4, clean session, keep-alive 30 s
      ws.send(packet(0x10, str('MQTT').concat([4, 2, 0, 30]).concat(str(id))));
    };
    ws.onmessage = function (e) { self.feed(new Uint8Array(e.data)); };
    ws.onclose = function () {
      var wasUp = self.connected;
      self.connected = false;
      clearInterval(self.ping);
      if (!wasUp) self.brokerIndex++;        // that broker failed: try the next one
      self.state('offline');
      self.later();
    };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  };
  Client.prototype.later = function () {
    var self = this;
    if (this.closedByUser) return;
    setTimeout(function () { self.open(); }, this.retry);
    this.retry = Math.min(this.retry * 2, 15000);
  };
  Client.prototype.feed = function (chunk) {
    var b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf); b.set(chunk, this.buf.length);
    while (b.length >= 2) {
      var mul = 1, len = 0, i = 1, d;
      do { if (i >= b.length) { this.buf = b; return; } d = b[i++]; len += (d & 127) * mul; mul *= 128; } while (d & 128);
      if (b.length < i + len) break;
      this.handle(b[0], b.subarray(i, i + len));
      b = b.slice(i + len);
    }
    this.buf = b;
  };
  Client.prototype.handle = function (h, body) {
    var type = h >> 4;
    if (type === 2) {                                   // CONNACK
      if (body[1] !== 0) { this.ws.close(); return; }
      this.connected = true; this.retry = 1000;
      var self = this;
      this.subs.forEach(function (t) { self.sendSub(t); });
      this.ping = setInterval(function () { try { self.ws.send(new Uint8Array([0xC0, 0])); } catch (e) {} }, 20000);
      this.state('online');
    } else if (type === 3) {                            // PUBLISH
      var tl = (body[0] << 8) | body[1], topic = dec.decode(body.subarray(2, 2 + tl)), p = 2 + tl;
      if ((h >> 1) & 3) p += 2;                          // QoS > 0 carries a packet id
      if (this.opts.onMessage) this.opts.onMessage(topic, dec.decode(body.subarray(p)));
    }
  };
  Client.prototype.sendSub = function (topic) {
    var id = this.nextId++ & 0xffff || 1;
    this.ws.send(packet(0x82, [id >> 8, id & 255].concat(str(topic)).concat([0])));
  };
  Client.prototype.subscribe = function (topic) {
    this.subs.push(topic);
    if (this.connected) this.sendSub(topic);
  };
  Client.prototype.publish = function (topic, text) {
    if (!this.connected) return false;
    this.ws.send(packet(0x30, str(topic).concat(Array.from(enc.encode(text)))));
    return true;
  };
  Client.prototype.close = function () {
    this.closedByUser = true;
    clearInterval(this.ping);
    try { this.ws.send(new Uint8Array([0xE0, 0])); this.ws.close(); } catch (e) {}
  };

  global.BadukMqtt = { connect: function (opts) { return new Client(opts); }, topic: function (code, side) { return 'badukcast/v1/' + code + '/' + side; } };
})(window);
