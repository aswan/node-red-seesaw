
// This class exists to coordinate concurrent access to a single seesaw controller.
// Since a single high-level operation (e.g. reading the position of a rotary encoder)
// entails writing to the i2c bus and then reading from is after a short delay (*),
// concurrent operations must be serialized so these steps don't get interleaved.
//
// * - see sample code at
//   https://learn.adafruit.com/adafruit-seesaw-atsamd09-breakout/reading-and-writing-data)
class SeesawManager {
    static allManagers = new Map();
    static get(busno) {
	if (!SeesawManager.allManagers.has(busno)) {
	    const mgr = new SeesawManager(busno);
	    SeesawManager.allManagers.set(busno, mgr);
	}

	return SeesawManager.allManagers.get(busno);
    }

    constructor(busno) {
	const i2c = require('i2c-bus');
	this.bus = i2c.openSync(busno);

	this.lastReadPosition = Promise.resolve();
    }

    // Read the position of a rotary encoder
    // Note this function returns a Promise that resolves to the position
    readPosition(device, encoder) {
	this.lastReadPosition = this.lastReadPosition
	    .then(() => this._readPositionUnsynchronized(device, encoder))
	    .catch(err => {
		console.error(err);
		return 0;
	    });
	return this.lastReadPosition;
    }

    async _readPositionUnsynchronized(device, encoder) {
	// Magic constants are documented at:
	// https://learn.adafruit.com/adafruit-seesaw-atsamd09-breakout/encoder
	const ENCODER_BASE_REGISTER = 0x11;
	const ENCODER_POSITION0 = 0x30;
	const position = ENCODER_POSITION0 + encoder

	this.bus.i2cWriteSync(device, 2, Buffer.from([ENCODER_BASE_REGISTER, position]));
	// pause 8 ms
	await new Promise(r => setTimeout(r, 8));

	const reply = Buffer.alloc(4);
	this.bus.i2cReadSync(device, 4, reply);
	return (reply[0] << 24) | (reply[1] << 16) | (reply[2] << 8) | reply[3];
    }
};

module.exports = function(RED) {
    function SeesawNode(config) {
        RED.nodes.createNode(this, config);
        let node = this;

	const POLL_INTERVAL = 200;

	const busno = (Number.isInteger(config.bus) ? config.bus : parseInt(config.bus)) || 1;
	const device = (Number.isInteger(config.device) ? config.device : parseInt(config.device)) || 0x49;
	const encoder = (Number.isInteger(config.encoder) ? config.encoder : parseInt(config.encoder)) || 0;

	const manager = SeesawManager.get(busno);

	let position = 0;
	let closing = false;
	node.on("close", () => { closing = true; });

	async function poll() {
	    if (closing) { return; }
	    const p = await manager.readPosition(device, encoder);
	    let interval = POLL_INTERVAL;
	    if (p != position) {
		position = p;
		const msg = {
		    payload: position,
		};
		node.send(msg);
		interval = 8;
	    }

	    setTimeout(poll, interval);
	}
	poll();
    }

    RED.nodes.registerType("seesaw", SeesawNode);
}
