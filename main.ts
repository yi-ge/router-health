import bent from 'bent'
import schedule from 'node-schedule'
import crypto from 'crypto'

const CRON_CONFIG = '* * * * *' // 检测频率，Cron表达式
const CHECKOUT_TIMEOUT = 10 * 1000 // 检测超时时间，ms
const CHECKOUT_TIME = 3 // 检测连续超时x次后重启
const CHECKOUT_WEB = 'https://www.wyr.me' // 检测基准站点
const RESTART_IKUAI = true // 重启爱快
const RESTART_OPENWRT = true // 重启OpenWRT

const IKUAI_ROUTER_SCHEMA = 'http' // 爱快路由器管理地址请求方式，HTTP or HTTPS
const IKUAI_ROUTER_HOST_AND_PORT = '10.10.11.253' // 爱快路由器管理地址HOST:PORT
const IKUAI_USERNAME = 'admin'
const IKUAI_PASSWORD = ''

const OPENWRT_ROUTER_SCHEMA = 'http' // OpenWRT路由器管理地址请求方式，HTTP or HTTPS
const OPENWRT_ROUTER_HOST_AND_PORT = '10.10.11.252' // OpenWRT路由器理地址HOST:PORT
const OPENWRT_USERNAME = 'root'
const OPENWRT_PASSWORD = ''

const iKuaiPost = bent(IKUAI_ROUTER_SCHEMA + '://' + IKUAI_ROUTER_HOST_AND_PORT, 'POST')
const openWRTGet = bent(OPENWRT_ROUTER_SCHEMA + '://' + OPENWRT_ROUTER_HOST_AND_PORT, 'GET')
const openWRTPost = bent(OPENWRT_ROUTER_SCHEMA + '://' + OPENWRT_ROUTER_HOST_AND_PORT, 'POST')
const checkoutRequest = bent('GET', 200, 201);
// @ts-ignore
checkoutRequest.timeout = CHECKOUT_TIMEOUT;

let ikuaiAccessKey: string = ''
let openWRTAccessKey: string = ''
let timeoutTime = 0

const loginInfo = {
  passwd: crypto.createHash("md5").update(IKUAI_PASSWORD).digest("hex"),
  pass: new (Buffer.from as any)("salt_11" + IKUAI_PASSWORD).toString('base64'),
  remember_password: 'true',
  username: IKUAI_USERNAME
}

const loginIkuai = async () => {
  const res: any = await iKuaiPost('/Action/login', loginInfo)

  if (res) {
    const data: any = await res.json()
    console.log(data)
    if (data.Result == 10000) {
      ikuaiAccessKey = res.headers['set-cookie'][0]
      console.log(ikuaiAccessKey)
    }
  }
}

const restartIkuai = async () => {
  const res: any = await iKuaiPost('/Action/call', {
    action: "reboots",
    func_name: "reboots"
  }, {
    'Cookie': ikuaiAccessKey
  })

  if (res) {
    const data: any = await res.json()
    console.log(data)
    if (data.Result == 30000) { // Success
      console.log('Restart command ok.')
    }
  }
}

const loginOpenWRT = async () => {
  try {
    await openWRTPost('/cgi-bin/luci/', `luci_username=${OPENWRT_USERNAME}&luci_password=${OPENWRT_PASSWORD}`, {
      'Content-Type': 'application/x-www-form-urlencoded'
    })
  } catch (err: any) {
    if (err && err.statusCode === 302) {
      openWRTAccessKey = err.headers['set-cookie'][0]
    } else {
      console.log('Username or password incorrect.')
    }
  }
}

const restartOpenWRT = async () => {
  try {
    const getRebootPage: any = await openWRTGet('/cgi-bin/luci/admin/system/reboot', '', {
      'Cookie': openWRTAccessKey
    })
    const rebootPageText = await getRebootPage.text()
    const start = '{ token: \''
    const end = '\' }, check'
    const matchRes = rebootPageText.match(new RegExp(`${start}(.*?)${end}`))
    const token = matchRes ? matchRes[1] : null
    if (!token) console.log('Get token failed.') // 获取重启Token失败
    // console.log(token)
    const res: any = await openWRTPost('/cgi-bin/luci/admin/system/reboot/call', `token=${token}&_=${Math.random()}`, {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': openWRTAccessKey
    })

    if (res && res.statusCode === 200) {
      console.log('OpenWRT restart command ok.')
    }
  } catch (err: any) {
    console.log(err)
  }
}

const checkoutNetwork = async () => {
  try {
    const res: any = await checkoutRequest(CHECKOUT_WEB)
    if (res.StatusCode === 200) {
      timeoutTime = 0
    }
  } catch (err: any) {
    console.log(err)
    // if (err.code) {
    // }
    if (++timeoutTime + 1 === CHECKOUT_TIME) {
      if (RESTART_IKUAI) {
        loginIkuai().then(() => {
          restartIkuai()
        })
      }
      if (RESTART_OPENWRT) {
        loginOpenWRT().then(() => {
          restartOpenWRT()
        })
      }
    }
  }
}

checkoutNetwork()

const job = schedule.scheduleJob(CRON_CONFIG, function () {
  checkoutNetwork()
})
