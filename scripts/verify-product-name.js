import { normalizeProductName } from '../packages/shared/src/product-name.js'

const cases = [
  ['小新PrO16', '小新Pro16'],
  ['小新PR016', '小新Pro16'],
  ['小新 pr016', '小新Pro16'],
  ['小新 pro 16', '小新Pro16'],
  ['小新PR0 16', '小新Pro16'],
  ['小新 pRo 16 512G', '小新Pro16 512G'],
  ['小新Pro16', '小新Pro16'],
  ['小新Air14', '小新Air14'],
  ['小新alR14', '小新Air14'],
  ['小新PlUS16', '小新Plus16'],
  ['小新P1us16', '小新Plus16'],
  ['拯救者y9000P', '拯救者Y9000P'],
  ['拯救者Y9000P', '拯救者Y9000P'],
  ['LECOO 显示器', 'Lecoo 显示器'],
  ['ThinkPAd E14', 'ThinkPad E14'],
  ['thinkbook 14', 'ThinkBook 14'],
  ['YOGA PrO14s', 'YOGA Pro14s'],
  ['ThinkB00k 14', 'ThinkBook 14'],
  ['小新Pro16 [型号:82XK]', '小新Pro16'],
  ['小新Pro16 型号：82XK', '小新Pro16'],
  ['数量 小新Pro16', '小新Pro16'],
  ['联想 小新Pro16', '小新Pro16'],
  [' 小新Pro16  ', '小新Pro16'],
  ['小新14IMH10GRXU516G51211C', '小新 14IMH10GRXU516G51211C'],
  ['Lec00N140A2C531512G512GGS-11', 'Lecoo N140A2C531512G512GGS-11'],
  ['Leco0N155DL2135H24G512G496bal-11', 'Lecoo N155DL2135H24G512G496bal-11'],
  ['ThinkBook14 G6', 'ThinkBook 14 G6'],
  ['', ''],
  // 以下必须原样保留，确认归一化不误伤真实数字与外部品牌
  ['小新Pro16 i5-12500H 16G 512G', '小新Pro16 i5-12500H 16G 512G'],
  ['小新Air14 Plus', '小新Air14 Plus'],
  ['拯救者Y9000P RTX4060', '拯救者Y9000P RTX4060'],
  ['拯救者R7000P', '拯救者R7000P'],
  ['拯救者Y9OOOP', '拯救者Y9OOOP'],
  ['ThinkPad E14 i7-1355U', 'ThinkPad E14 i7-1355U'],
  ['ThinkBook 14 G6', 'ThinkBook 14 G6'],
  ['YOGA Pro14s Carbon', 'YOGA Pro14s Carbon'],
  ['Lecoo 27英寸显示器', 'Lecoo 27英寸显示器'],
  ['LOQ 15IRH8', 'LOQ 15IRH8'],
  ['IdeaPad Slim 5', 'IdeaPad Slim 5'],
  ['TB370FU', 'TB370FU'],
  ['斗战者JX600', '斗战者JX600'],
  ['罗技 M720 鼠标', '罗技 M720 鼠标'],
  ['华为 MateBook 14', '华为 MateBook 14'],
  ['Apple MacBook Air M2', 'Apple MacBook Air M2'],
  ['小米平板 6 Pro', '小米平板 6 Pro'],
]

const failures = []
for (const [input, expected] of cases) {
  const actual = normalizeProductName(input)
  if (actual !== expected) failures.push({ input, expected, actual })
}

if (failures.length) {
  for (const { input, expected, actual } of failures) {
    console.error(`失败 ${JSON.stringify(input)} 期望 ${JSON.stringify(expected)} 实际 ${JSON.stringify(actual)}`)
  }
  throw new Error(`商品名称归一化用例失败 ${failures.length} 条`)
}

console.log(`商品名称归一化用例全部通过（${cases.length} 条）`)
