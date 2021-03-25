const { EventEmitter } = require('events')
const HDKey = require('hdkey')
const ProkeyDevice = require('@prokey-io/webcore')

const hdPathString = `m/44'/60'/0'/0`

class ProkeyKeyring extends EventEmitter {
    constructor(opts = {}) {
        super();
        this.device = new ProkeyDevice.Device();
        this.device.AddOnButtonRequestCallBack(OnProkeyButtonRequest);
        this.device.AddOnFailureCallBack(OnProkeyFailure);
        this.device.AddOnDeviceDisconnectCallBack(OnProkeyDisconnect);
        this.device.AddOnPasspharaseRequestCallBack(OnProkeyPassPhrase);
        this.ethDevice = new ProkeyDevice.EthereumCommands();
        this.type = keyringType;
        this.accounts = [];
        this.hdk = new HDKey();
        this.page = 0;
        this.perPage = 5;
        this.isDeviceRebooted = false;
    }

    // **********************************
    // ProKey Events
    // **********************************
    OnProkeyButtonRequest(buttonRequestType) {
        console.debug('Please check your device and continue, the request is -> ', buttonRequestType);
        return true;
    }

    OnProkeyFailure(failureType) {
        console.error(' Command failed, the failureType is -> ');
        console.error(failureType);
        this.device.RebootDevice();
        this.isDeviceRebooted = true;
    }

    OnProkeyDisconnect() {
        console.debug("Prokey Disconnected");
    }

    OnProkeyPassPhrase() {
        console.debug('Passphrase');
    }

    serialize() {
        return Promise.resolve({
            hdPath: this.hdPath,
            accounts: this.accounts,
            page: this.page,
            perPage: this.perPage,
        });
    }

    deserialize(opts = {}) {
        this.hdPath = opts.hdPath || hdPathString;
        this.accounts = opts.accounts || [];
        this.page = opts.page || 0;
        this.perPage = opts.perPage || 5;
        return Promise.resolve();
    }

    isUnlocked() {
        return Boolean(this.hdk && this.hdk.publicKey)
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.device.TransportConnect().then((response) => {
                if (response.success) {
                    this.device.Initialize().then((response) => {
                        resolve(response);
                    }).catch((e) => {
                        if (this.isDeviceRebooted) {
                            // device rebooted we can try again
                            this.isDeviceRebooted = false;
                            this.device.TransportConnect().then((response) => {
                                this.device.Initialize().then((response) => {
                                    resolve(response);
                                }).catch((e) => {
                                    reject(e);
                                })
                            }).catch((e) => {
                                reject(e);
                            });
                        }
                    })
                }
                else 
                    reject();                
            }).catch((e) => {
                reject(e);
            });
        });
    }

    unlock() {
        if (this.isUnlocked()) {
            return Promise.resolve('already unlocked')
        }
        return new Promise((resolve, reject) => {
            this.connect.then(() => {
                // now prokey is connected
                // get public key
                this.ethDevice.GetPublicKey(this.device, this.hdPath, false).then((response) => {
                    this.hdk.publicKey = Buffer.from(response.node.public_Key, 'hex');
                    this.hdk.chainCode = Buffer.from(response.node.chain_code, 'hex');
                    resolve('just unlocked');
                }).catch((e) => {
                    reject(new Error((e && e.toString()) || 'Unknown error'));
                });
            }).catch((e) => {
                reject(new Error((e && e.toString()) || 'Unknown error'));
            });
        });
    }
    
}