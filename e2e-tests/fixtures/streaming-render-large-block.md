Writing a large file to verify the in-progress open-block render path.

<dyad-write path="src/streaming/StreamingRenderLargeBlock.tsx" description="Large block test fixture for in-progress render">
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

// This fixture is intentionally large so that the renderer spends a meaningful
// portion of stream time inside the open dyad-write tag. The e2e test asserts
// that the renderer surfaces the path attribute and the "Writing..." pending
// indicator while the closing tag has not yet arrived.

export interface StreamingRenderLargeBlockProps {
  initialValue?: number;
  step?: number;
  label?: string;
}

const DEFAULT_STEP = 1;
const DEFAULT_INITIAL_VALUE = 0;
const DEFAULT_LABEL = "StreamingRenderLargeBlock";

export const StreamingRenderLargeBlock: React.FC<StreamingRenderLargeBlockProps> = ({
  initialValue = DEFAULT_INITIAL_VALUE,
  step = DEFAULT_STEP,
  label = DEFAULT_LABEL,
}) => {
  const [value, setValue] = useState<number>(initialValue);
  const previousValue = useRef<number>(initialValue);

  const increment = useCallback(() => {
    setValue((prev) => prev + step);
  }, [step]);

  const decrement = useCallback(() => {
    setValue((prev) => prev - step);
  }, [step]);

  const reset = useCallback(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    previousValue.current = value;
  }, [value]);

  const summary = useMemo(() => {
    return `${label}: current=${value}, previous=${previousValue.current}, step=${step}`;
  }, [label, value, step]);

  // Padding lines so the streamed content takes long enough that the e2e test
  // can reliably observe the open dyad-write tag mid-stream. The fake LLM
  // server streams 32 characters every 10ms, so each kilobyte of content adds
  // roughly 300ms to the total stream time.
  // padding-line-0001
  // padding-line-0002
  // padding-line-0003
  // padding-line-0004
  // padding-line-0005
  // padding-line-0006
  // padding-line-0007
  // padding-line-0008
  // padding-line-0009
  // padding-line-0010
  // padding-line-0011
  // padding-line-0012
  // padding-line-0013
  // padding-line-0014
  // padding-line-0015
  // padding-line-0016
  // padding-line-0017
  // padding-line-0018
  // padding-line-0019
  // padding-line-0020
  // padding-line-0021
  // padding-line-0022
  // padding-line-0023
  // padding-line-0024
  // padding-line-0025
  // padding-line-0026
  // padding-line-0027
  // padding-line-0028
  // padding-line-0029
  // padding-line-0030
  // padding-line-0031
  // padding-line-0032
  // padding-line-0033
  // padding-line-0034
  // padding-line-0035
  // padding-line-0036
  // padding-line-0037
  // padding-line-0038
  // padding-line-0039
  // padding-line-0040
  // padding-line-0041
  // padding-line-0042
  // padding-line-0043
  // padding-line-0044
  // padding-line-0045
  // padding-line-0046
  // padding-line-0047
  // padding-line-0048
  // padding-line-0049
  // padding-line-0050
  // padding-line-0051
  // padding-line-0052
  // padding-line-0053
  // padding-line-0054
  // padding-line-0055
  // padding-line-0056
  // padding-line-0057
  // padding-line-0058
  // padding-line-0059
  // padding-line-0060
  // padding-line-0061
  // padding-line-0062
  // padding-line-0063
  // padding-line-0064
  // padding-line-0065
  // padding-line-0066
  // padding-line-0067
  // padding-line-0068
  // padding-line-0069
  // padding-line-0070
  // padding-line-0071
  // padding-line-0072
  // padding-line-0073
  // padding-line-0074
  // padding-line-0075
  // padding-line-0076
  // padding-line-0077
  // padding-line-0078
  // padding-line-0079
  // padding-line-0080
  // padding-line-0081
  // padding-line-0082
  // padding-line-0083
  // padding-line-0084
  // padding-line-0085
  // padding-line-0086
  // padding-line-0087
  // padding-line-0088
  // padding-line-0089
  // padding-line-0090
  // padding-line-0091
  // padding-line-0092
  // padding-line-0093
  // padding-line-0094
  // padding-line-0095
  // padding-line-0096
  // padding-line-0097
  // padding-line-0098
  // padding-line-0099
  // padding-line-0100
  // padding-line-0101
  // padding-line-0102
  // padding-line-0103
  // padding-line-0104
  // padding-line-0105
  // padding-line-0106
  // padding-line-0107
  // padding-line-0108
  // padding-line-0109
  // padding-line-0110
  // padding-line-0111
  // padding-line-0112
  // padding-line-0113
  // padding-line-0114
  // padding-line-0115
  // padding-line-0116
  // padding-line-0117
  // padding-line-0118
  // padding-line-0119
  // padding-line-0120
  // padding-line-0121
  // padding-line-0122
  // padding-line-0123
  // padding-line-0124
  // padding-line-0125
  // padding-line-0126
  // padding-line-0127
  // padding-line-0128
  // padding-line-0129
  // padding-line-0130
  // padding-line-0131
  // padding-line-0132
  // padding-line-0133
  // padding-line-0134
  // padding-line-0135
  // padding-line-0136
  // padding-line-0137
  // padding-line-0138
  // padding-line-0139
  // padding-line-0140
  // padding-line-0141
  // padding-line-0142
  // padding-line-0143
  // padding-line-0144
  // padding-line-0145
  // padding-line-0146
  // padding-line-0147
  // padding-line-0148
  // padding-line-0149
  // padding-line-0150
  // padding-line-0151
  // padding-line-0152
  // padding-line-0153
  // padding-line-0154
  // padding-line-0155
  // padding-line-0156
  // padding-line-0157
  // padding-line-0158
  // padding-line-0159
  // padding-line-0160
  // padding-line-0161
  // padding-line-0162
  // padding-line-0163
  // padding-line-0164
  // padding-line-0165
  // padding-line-0166
  // padding-line-0167
  // padding-line-0168
  // padding-line-0169
  // padding-line-0170
  // padding-line-0171
  // padding-line-0172
  // padding-line-0173
  // padding-line-0174
  // padding-line-0175
  // padding-line-0176
  // padding-line-0177
  // padding-line-0178
  // padding-line-0179
  // padding-line-0180
  // padding-line-0181
  // padding-line-0182
  // padding-line-0183
  // padding-line-0184
  // padding-line-0185
  // padding-line-0186
  // padding-line-0187
  // padding-line-0188
  // padding-line-0189
  // padding-line-0190
  // padding-line-0191
  // padding-line-0192
  // padding-line-0193
  // padding-line-0194
  // padding-line-0195
  // padding-line-0196
  // padding-line-0197
  // padding-line-0198
  // padding-line-0199
  // padding-line-0200
  // padding-line-0201
  // padding-line-0202
  // padding-line-0203
  // padding-line-0204
  // padding-line-0205
  // padding-line-0206
  // padding-line-0207
  // padding-line-0208
  // padding-line-0209
  // padding-line-0210
  // padding-line-0211
  // padding-line-0212
  // padding-line-0213
  // padding-line-0214
  // padding-line-0215
  // padding-line-0216
  // padding-line-0217
  // padding-line-0218
  // padding-line-0219
  // padding-line-0220
  // padding-line-0221
  // padding-line-0222
  // padding-line-0223
  // padding-line-0224
  // padding-line-0225
  // padding-line-0226
  // padding-line-0227
  // padding-line-0228
  // padding-line-0229
  // padding-line-0230
  // padding-line-0231
  // padding-line-0232
  // padding-line-0233
  // padding-line-0234
  // padding-line-0235
  // padding-line-0236
  // padding-line-0237
  // padding-line-0238
  // padding-line-0239
  // padding-line-0240
  // padding-line-0241
  // padding-line-0242
  // padding-line-0243
  // padding-line-0244
  // padding-line-0245
  // padding-line-0246
  // padding-line-0247
  // padding-line-0248
  // padding-line-0249
  // padding-line-0250
  // padding-line-0251
  // padding-line-0252
  // padding-line-0253
  // padding-line-0254
  // padding-line-0255
  // padding-line-0256
  // padding-line-0257
  // padding-line-0258
  // padding-line-0259
  // padding-line-0260
  // padding-line-0261
  // padding-line-0262
  // padding-line-0263
  // padding-line-0264
  // padding-line-0265
  // padding-line-0266
  // padding-line-0267
  // padding-line-0268
  // padding-line-0269
  // padding-line-0270
  // padding-line-0271
  // padding-line-0272
  // padding-line-0273
  // padding-line-0274
  // padding-line-0275
  // padding-line-0276
  // padding-line-0277
  // padding-line-0278
  // padding-line-0279
  // padding-line-0280
  // padding-line-0281
  // padding-line-0282
  // padding-line-0283
  // padding-line-0284
  // padding-line-0285
  // padding-line-0286
  // padding-line-0287
  // padding-line-0288
  // padding-line-0289
  // padding-line-0290
  // padding-line-0291
  // padding-line-0292
  // padding-line-0293
  // padding-line-0294
  // padding-line-0295
  // padding-line-0296
  // padding-line-0297
  // padding-line-0298
  // padding-line-0299
  // padding-line-0300
  // padding-line-0301
  // padding-line-0302
  // padding-line-0303
  // padding-line-0304
  // padding-line-0305
  // padding-line-0306
  // padding-line-0307
  // padding-line-0308
  // padding-line-0309
  // padding-line-0310
  // padding-line-0311
  // padding-line-0312
  // padding-line-0313
  // padding-line-0314
  // padding-line-0315
  // padding-line-0316
  // padding-line-0317
  // padding-line-0318
  // padding-line-0319
  // padding-line-0320
  // padding-line-0321
  // padding-line-0322
  // padding-line-0323
  // padding-line-0324
  // padding-line-0325
  // padding-line-0326
  // padding-line-0327
  // padding-line-0328
  // padding-line-0329
  // padding-line-0330
  // padding-line-0331
  // padding-line-0332
  // padding-line-0333
  // padding-line-0334
  // padding-line-0335
  // padding-line-0336
  // padding-line-0337
  // padding-line-0338
  // padding-line-0339
  // padding-line-0340
  // padding-line-0341
  // padding-line-0342
  // padding-line-0343
  // padding-line-0344
  // padding-line-0345
  // padding-line-0346
  // padding-line-0347
  // padding-line-0348
  // padding-line-0349
  // padding-line-0350
  // padding-line-0351
  // padding-line-0352
  // padding-line-0353
  // padding-line-0354
  // padding-line-0355
  // padding-line-0356
  // padding-line-0357
  // padding-line-0358
  // padding-line-0359
  // padding-line-0360
  // padding-line-0361
  // padding-line-0362
  // padding-line-0363
  // padding-line-0364
  // padding-line-0365
  // padding-line-0366
  // padding-line-0367
  // padding-line-0368
  // padding-line-0369
  // padding-line-0370
  // padding-line-0371
  // padding-line-0372
  // padding-line-0373
  // padding-line-0374
  // padding-line-0375
  // padding-line-0376
  // padding-line-0377
  // padding-line-0378
  // padding-line-0379
  // padding-line-0380
  // padding-line-0381
  // padding-line-0382
  // padding-line-0383
  // padding-line-0384
  // padding-line-0385
  // padding-line-0386
  // padding-line-0387
  // padding-line-0388
  // padding-line-0389
  // padding-line-0390
  // padding-line-0391
  // padding-line-0392
  // padding-line-0393
  // padding-line-0394
  // padding-line-0395
  // padding-line-0396
  // padding-line-0397
  // padding-line-0398
  // padding-line-0399
  // padding-line-0400

  return (
    <div data-testid="streaming-render-large-block">
      <h1>{label}</h1>
      <p>{summary}</p>
      <button type="button" onClick={increment}>
        Increment
      </button>
      <button type="button" onClick={decrement}>
        Decrement
      </button>
      <button type="button" onClick={reset}>
        Reset
      </button>
    </div>
  );
};

export default StreamingRenderLargeBlock;
</dyad-write>

Wrote one large file.
