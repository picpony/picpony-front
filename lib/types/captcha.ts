export interface CaptchaGetResponse {
  success: boolean;
  bg: string;
  piece: string;
  y: number;
}

export interface CaptchaVerifyResponse {
  success: boolean;
  token: string;
}
