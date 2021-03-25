const { EventEmitter } = require('events')
const ethUtil = require('ethereumjs-util')
const Transaction = require('ethereumjs-tx')
const HDKey = require('hdkey')
const ProkeyDevice = require('@prokey-io/webcore')

const hdPathString = `m/44'/60'/0'/0`;
const keyringType = 'Prokey Hardware';
const pathBase = 'm';

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

    setAccountToUnlock(index) {
        this.unlockedAccount = parseInt(index, 10)
    }

    addAccounts(n = 1) {
        return new Promise((resolve, reject) => {
            this.unlock()
                .then((_) => {
                    const from = this.unlockedAccount
                    const to = from + n

                    for (let i = from; i < to; i++) {
                        const address = this._addressFromIndex(pathBase, i)
                        if (!this.accounts.includes(address)) {
                            this.accounts.push(address)
                        }
                        this.page = 0
                    }
                    resolve(this.accounts)
                })
                .catch((e) => {
                    reject(e)
                })
        })
    }

    getFirstPage() {
        this.page = 0
        return this.__getPage(1)
    }

    getNextPage() {
        return this.__getPage(1)
    }

    getPreviousPage() {
        return this.__getPage(-1)
    }

    __getPage(increment) {
        this.page += increment

        if (this.page <= 0) {
            this.page = 1
        }

        return new Promise((resolve, reject) => {
            this.unlock()
                .then((_) => {

                    const from = (this.page - 1) * this.perPage
                    const to = from + this.perPage

                    const accounts = []

                    for (let i = from; i < to; i++) {
                        const address = this._addressFromIndex(pathBase, i)
                        accounts.push({
                            address,
                            balance: null,
                            index: i,
                        })
                        this.paths[ethUtil.toChecksumAddress(address)] = i

                    }
                    resolve(accounts)
                })
                .catch((e) => {
                    reject(e)
                })
        })
    }

    getAccounts() {
        return Promise.resolve(this.accounts.slice())
    }

    removeAccount(address) {
        if (!this.accounts.map((a) => a.toLowerCase()).includes(address.toLowerCase())) {
            throw new Error(`Address ${address} not found in this keyring`)
        }
        this.accounts = this.accounts.filter((a) => a.toLowerCase() !== address.toLowerCase())
    }

    // tx is an instance of the ethereumjs-transaction class.
    signTransaction(address, tx) {
        return new Promise((resolve, reject) => {
            this.unlock()
                .then((status) => {
                    this.ethDevice.SignTransaction(
                        this.device,
                        {
                            address_n: this._pathFromAddress(address),
                            to: this._normalize(tx.to),
                            value: this._normalize(tx.value),
                            gasPrice: this._normalize(tx.gasPrice),
                            gasLimit: this._normalize(tx.gasLimit),
                            nonce: this._normalize(tx.nonce),
                            data: this._normalize(tx.data),
                            chainId: tx._chainId,
                        }).then((response) => {
                            tx.v = response.v
                            tx.r = response.r
                            tx.s = response.s

                            const signedTx = new Transaction(tx)

                            const addressSignedWith = ethUtil.toChecksumAddress(`0x${signedTx.from.toString('hex')}`)
                            const correctAddress = ethUtil.toChecksumAddress(address)
                            if (addressSignedWith !== correctAddress) {
                                reject(new Error('signature doesnt match the right address'))
                            }

                            resolve(signedTx)
                        }).catch((e) => {
                            reject(new Error((e && e.toString()) || 'Unknown error'))
                        })

                }).catch((e) => {
                    reject(new Error((e && e.toString()) || 'Unknown error'))
                })
        })
    }
}

ProkeyKeyring.type = keyringType;
module.exports = ProkeyKeyring;