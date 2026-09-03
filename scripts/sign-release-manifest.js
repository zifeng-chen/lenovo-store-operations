import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(projectRoot, 'release-assets', 'manifest.json')
const signaturePath = path.join(projectRoot, 'release-assets', 'manifest.json.sig')
const checksumsPath = path.join(projectRoot, 'release-assets', 'SHA256SUMS')
const encodedPrivateKey = String(process.env.RELEASE_SIGNING_PRIVATE_KEY || '').trim()
const expectedPublicKeySha256 = String(process.env.RELEASE_SIGNING_PUBLIC_KEY_SHA256 || '').trim().toLowerCase()

if (!encodedPrivateKey) throw new Error('Release 签名失败：缺少 RELEASE_SIGNING_PRIVATE_KEY')
if (!fs.existsSync(manifestPath)) throw new Error('Release 签名失败：manifest.json 不存在')

let privateKeyPem
try {
  privateKeyPem = Buffer.from(encodedPrivateKey, 'base64').toString('utf8')
} catch {
  throw new Error('Release 签名失败：RELEASE_SIGNING_PRIVATE_KEY 必须是 base64 编码的 Ed25519 私钥 PEM')
}

const privateKey = crypto.createPrivateKey(privateKeyPem)
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Release 签名失败：只允许 Ed25519 私钥')
if (!/^[0-9a-f]{64}$/.test(expectedPublicKeySha256)) throw new Error('Release 签名失败：缺少有效的 RELEASE_SIGNING_PUBLIC_KEY_SHA256')
const publicKey = crypto.createPublicKey(privateKey)
const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' })
const actualPublicKeySha256 = crypto.createHash('sha256').update(publicKeyDer).digest('hex')
if (actualPublicKeySha256 !== expectedPublicKeySha256) throw new Error('Release 签名失败：私钥与固定部署公钥指纹不一致')
const manifest = fs.readFileSync(manifestPath)
const signature = crypto.sign(null, manifest, privateKey)
if (signature.length !== 64 || !crypto.verify(null, manifest, publicKey, signature)) throw new Error('Release 签名失败：签名自校验未通过')
fs.writeFileSync(signaturePath, `${signature.toString('base64')}\n`, { mode: 0o600 })
const signatureDigest = crypto.createHash('sha256').update(fs.readFileSync(signaturePath)).digest('hex')
fs.appendFileSync(checksumsPath, `${signatureDigest}  manifest.json.sig\n`)
console.log('Release manifest Ed25519 签名已生成')
