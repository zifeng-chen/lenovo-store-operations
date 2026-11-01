// 真实 SSR 渲染测试：检查组件是否能解析
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

// 构造一个使用相同组件的测试组件
const TestApp = {
  template: `
    <div>
      <el-alert title="t" />
      <el-button>b</el-button>
      <el-date-picker model-value="" type="daterange" />
      <el-radio-group model-value="a">
        <el-radio-button value="a">A</el-radio-button>
      </el-radio-group>
      <el-table :data="[]">
        <el-table-column prop="x" label="X" />
      </el-table>
      <el-pagination :total="0" />
    </div>
  `,
}

const warnings = []
const app = createSSRApp(TestApp)
app.use(ElementPlus, { locale: zhCn })
app.config.warnHandler = (msg) => warnings.push(msg)

const html = await renderToString(app)
console.log('渲染长度:', html.length)
console.log('警告数:', warnings.length)
warnings.slice(0, 8).forEach(w => console.log('  ⚠', w.slice(0, 120)))
