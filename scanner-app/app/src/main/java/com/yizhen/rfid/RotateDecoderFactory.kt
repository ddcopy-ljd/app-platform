package com.yizhen.rfid

import com.google.zxing.DecodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.Reader
import com.google.zxing.Result
import com.journeyapps.barcodescanner.Decoder
import com.journeyapps.barcodescanner.DecoderFactory

/**
 * 任意方向解码：
 * 库自带的解码器只按横向扫描线识别，一维条码（CODE_128 / EAN 等）竖着放就扫不出来。
 * 这里在常规解码失败时，把图像旋转 90° 再试一次——横放、竖放的条码都能扫。
 * 二维码本身是二维的，不受方向影响，常规解码即命中，不会走到旋转分支。
 */
class RotateDecoderFactory : DecoderFactory {

    override fun createDecoder(baseHints: Map<DecodeHintType, *>?): Decoder {
        val reader = MultiFormatReader()
        val hints = HashMap<DecodeHintType, Any>()
        baseHints?.forEach { (k, v) -> if (v != null) hints[k] = v }
        hints[DecodeHintType.TRY_HARDER] = java.lang.Boolean.TRUE
        reader.setHints(hints)
        return RotateDecoder(reader)
    }
}

private class RotateDecoder(reader: Reader) : Decoder(reader) {

    override fun decode(source: LuminanceSource): Result {
        return try {
            super.decode(source)
        } catch (e: NotFoundException) {
            val rotated = rotate90(source) ?: throw e
            super.decode(rotated)
        }
    }

    /** 把灰度矩阵顺时针旋转 90°，构造一个新的亮度源。 */
    private fun rotate90(source: LuminanceSource): LuminanceSource? {
        val matrix = source.matrix ?: return null
        val w = source.width
        val h = source.height
        if (w <= 0 || h <= 0 || matrix.size < w * h) return null
        val out = ByteArray(w * h)
        for (y in 0 until h) {
            val row = y * w
            for (x in 0 until w) {
                out[x * h + (h - 1 - y)] = matrix[row + x]
            }
        }
        return PlanarYUVLuminanceSource(out, h, w, 0, 0, h, w, false)
    }
}
