import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const outputDirectory = path.resolve(process.argv[2] || '.')
fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 })
const privatePath = path.join(outputDirectory, 'release-signing-private.pem')
const publicPath = path.join(outputDirectory, 'release-signing-public.pem')
if (fs.existsSync(privatePath) || fs.existsSync(publicPath)) throw new Error('签名密钥文件已存在，拒绝覆盖')
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 })
const fingerprint = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
console.log(`私钥：${privatePath}`)
console.log(`公钥：${publicPath}`)
console.log(`公钥 SHA-256 指纹：${fingerprint}`)
console.log('将私钥 PEM 整体进行 base64 编码后保存为 GitHub Actions Secret：RELEASE_SIGNING_PRIVATE_KEY；将指纹保存为 Actions Variable：RELEASE_SIGNING_PUBLIC_KEY_SHA256；不要提交私钥。')
