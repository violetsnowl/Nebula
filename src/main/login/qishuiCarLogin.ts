/**
 * 汽水车机协议的授权入口（抖音扫码）：给 IPC / 登录面板用的薄封装，协议本身在 adapters/qishuiCar.ts。
 * 形状沿用其他平台的登录适配器：createCarQr 返回 { unikey, payload, imageDataUrl }，
 * pollCarQr 返回 { ok, message, final }，另带 state 方便界面区分「等待 / 已扫码 / 过期 / 拒绝」。
 * 车机票据和汽水 PC 扫码登录互相独立，退出一个不影响另一个。
 */
import type { CarQrState, CarStatus, QishuiCar } from '../adapters/qishuiCar';

export interface QishuiCarLogin {
  /** 取二维码：imageDataUrl 是抖音返回的 PNG（data URL），payload 恒为空串（接口不给二维码内容）。 */
  createCarQr(): Promise<{ unikey: string; payload: string; imageDataUrl: string; expiresIn: number }>;
  /** 轮询：不抛异常；ok = 授权成功；final = 不用再轮询。 */
  pollCarQr(unikey: string): Promise<{ ok: boolean; message: string; final?: boolean; state: CarQrState }>;
  /** 授权状态：authorized / unauthorized / expired（到期前一小时内会顺手续期）。 */
  carStatus(): Promise<CarStatus>;
  /** 退出车机授权（只清 qishui-car 票据）。 */
  carLogout(): Promise<boolean>;
}

export function createQishuiCarLogin(car: Pick<QishuiCar, 'createQr' | 'pollQr' | 'status' | 'logout'>): QishuiCarLogin {
  return {
    createCarQr: async () => {
      const qr = await car.createQr();
      return { unikey: qr.key, payload: '', imageDataUrl: qr.imageDataUrl, expiresIn: qr.expiresIn };
    },
    pollCarQr: async (unikey) => {
      const r = await car.pollQr(String(unikey || ''));
      return { ok: r.state === 'confirmed', message: r.message || '', ...(r.final ? { final: true } : {}), state: r.state };
    },
    carStatus: () => car.status(),
    carLogout: async () => { car.logout(); return true; },
  };
}
