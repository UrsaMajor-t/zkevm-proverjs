const { assert } = require("console");
const { fstat } = require("fs");
const fs = require("fs");
const { connect } = require("http2");
const path = require("path");
const { log2 } = require("@0xpolygonhermez/zkevm-commonjs").utils;
const { F1Field } = require("ffjavascript");
const getKs = require("pilcom").getKs;

const SlotSize = 158418;

module.exports.buildConstants = async function (pols) {
    const N = pols.ConnA.length;
    const NUsedBits = 9n;

    const F = new F1Field("0xFFFFFFFF00000001");

    const nSlots = Math.floor((N-1)/SlotSize);

    const conns = JSON.parse(await fs.promises.readFile(path.join(__dirname, "keccak_connections.json"), "utf8"));
    const script = JSON.parse(await fs.promises.readFile(path.join(__dirname, "keccak_script.json"), "utf8"));

    assert(conns.length == script.program.length +1);

    const pow = log2(N);
    assert(1<<pow == N);

    const ks = getKs(F, 2);

    let w = F.one;
    for (let i=0; i<N; i++) {
        pols.ConnA[i] = w;
        pols.ConnB[i] = F.mul(w, ks[0]);
        pols.ConnC[i] = F.mul(w, ks[1]);
        w = F.mul(w, F.FFT.w[pow]);
    }

    pols.GateType[0] = 0n

    for (let i=0; i<nSlots; i++) {
        const offset = i*SlotSize;

        for (let j=0; j<conns.length; j++) {
            const l = conns[j];
            let r1 = j;
            if (j>0) r1 += offset;
            if (l.A) {
                for (let k=0; k<l.A.length; k++) {
                    const ll = conns[j].A[k];
                    let r2 = ll[1];
                    if (r2>0) r2 += offset;
                    if (ll[0] == "A") {
                        connect(pols.ConnA, r1, pols.ConnA, r2);
                    } else if (ll[0] == "B") {
                        connect(pols.ConnA, r1, pols.ConnB, r2);
                    } else if (ll[0] == "C") {
                        connect(pols.ConnA, r1, pols.ConnC, r2);
                    } else {
                        assert(false, "Invalid pin");
                    }
                }
            }
            if (l.B) {
                for (let k=0; k<l.B.length; k++) {
                    const ll = conns[j].B[k];
                    let r2 = ll[1];
                    if (r2>0) r2 += offset;
                    if (ll[0] == "A") {
                        connect(pols.ConnB, r1, pols.ConnA, r2);
                    } else if (ll[0] == "B") {
                        connect(pols.ConnB, r1, pols.ConnB, r2);
                    } else if (ll[0] == "C") {
                        connect(pols.ConnB, r1, pols.ConnC, r2);
                    } else {
                        assert(false, "Invalid pin");
                    }
                }
            }
            if (l.C) {
                for (let k=0; k<l.C.length; k++) {
                    const ll = conns[j].C[k];
                    let r2 = ll[1];
                    if (r2>0) r2 += offset;
                    if (ll[0] == "A") {
                        connect(pols.ConnC, r1, pols.ConnA, r2);
                    } else if (ll[0] == "B") {
                        connect(pols.ConnC, r1, pols.ConnB, r2);
                    } else if (ll[0] == "C") {
                        connect(pols.ConnC, r1, pols.ConnC, r2);
                    } else {
                        assert(false, "Invalid pin");
                    }
                }
            }
        }
        for (let j=0; j<script.program.length; j++) {
            const lp = script.program[j];
            r1 = lp.ref;
            if (r1>0) r1 += offset;
            if (lp.op == "xor") {
                pols.GateType[r1] = 0n;
            } else if (lp.op == "andp") {
                pols.GateType[r1] = 1n;
            } else {
                assert(false, "Invalid op");
            }
        }
    }

    for (let k=1 + nSlots*SlotSize; k<N; k++) {
        pols.GateType[k] = 0n;
    }

    const mask = 0b100000010000001000000100000010000001000000100000010000001n;
    let c = 0;
    for (let a=0n; a<2n**NUsedBits; a++) {
        const bitsA = ((a & 2n**0n) ? 2n**0n:0n)  + ((a & 2n**1n) ? 2n**7n:0n)  + ((a & 2n**2n) ? 2n**14n:0n) + ((a & 2n**3n) ? 2n**21n:0n)
                    + ((a & 2n**4n) ? 2n**28n:0n) + ((a & 2n**5n) ? 2n**35n:0n) + ((a & 2n**6n) ? 2n**42n:0n) + ((a & 2n**7n) ? 2n**49n:0n)
                    + ((a & 2n**8n) ? 2n**56n:0n);
        for (let b=0n; b<2n**NUsedBits; b++) {
            const bitsB = ((b & 2n**0n) ? 2n**0n:0n)  + ((b & 2n**1n) ? 2n**7n:0n)  + ((b & 2n**2n) ? 2n**14n:0n) + ((b & 2n**3n) ? 2n**21n:0n)
                        + ((b & 2n**4n) ? 2n**28n:0n) + ((b & 2n**5n) ? 2n**35n:0n) + ((b & 2n**6n) ? 2n**42n:0n) + ((b & 2n**7n) ? 2n**49n:0n)
                        + ((b & 2n**8n) ? 2n**56n:0n);
            pols.kGateType[c] = 0n;
            pols.kA[c] = bitsA;
            pols.kB[c] = bitsB;
            pols.kC[c] = bitsA^bitsB;
            c++;
            pols.kGateType[c] = 1n;
            pols.kA[c] = bitsA;
            pols.kB[c] = bitsB;
            pols.kC[c] = (bitsA^mask)&bitsB;
            c++;
        }
    }
    while (c<N)
    {
        pols.kGateType[c] = 0n;
        pols.kA[c] = 0n;
        pols.kB[c] = 0n;
        pols.kC[c] = 0n;
        c++;
    }

    console.log("keccak build constants done");

    function connect(p1, i1, p2, i2) {
        [p1[i1], p2[i2]] = [p2[i2], p1[i1]];
    }
}

module.exports.execute = async function (pols, input) {
    const N = pols.a.length;

    const script = JSON.parse(await fs.promises.readFile(path.join(__dirname, "keccak_script.json"), "utf8"));

    let c_xor=0;
    let c_andp=0;

    assert(script.program.length == SlotSize);

    const nSlots = Math.floor((N-1)/SlotSize);

    pols.a[0] = 0n;
    pols.b[0] = 0b000000100000010000001000000100000010000001000000100000010000001n;
    pols.c[0] = 0b000000100000010000001000000100000010000001000000100000010000001n;

    let p=1;
    let offset = 0;

    for (let i=0; i<nSlots; i++) {
        for (let j=0; j<SlotSize; j++) {
            const l = script.program[j];
            const r = l.ref + i*SlotSize;

            if (l.a.type === "input") {
                pols.a[r] = input[i][l.a.bit];
            } else if (l.a.type === "wired") {
                let g = l.a.gate;
                if (g>0) g+=offset;
                if (l.a.pin=="a") {
                    pols.a[r] = pols.a[g];
                } else if (l.a.pin=="b") {
                    pols.a[r] = pols.b[g];
                } else if (l.a.pin=="c") {
                    pols.a[r] = pols.c[g];
                } else {
                    assert(false, "Invalid pin");
                }
            } else {
                assert(false, "Invalid field type");
            }

            if (l.b.type === "input") {
                pols.b[r] = input[i][l.b.bit];
            } else if (l.b.type === "wired") {
                let g = l.b.gate;
                if (g>0) g+=offset;
                if (l.b.pin=="a") {
                    pols.b[r] = pols.a[g];
                } else if (l.b.pin=="b") {
                    pols.b[r] = pols.b[g];
                } else if (l.b.pin=="c") {
                    pols.b[r] = pols.c[g];
                } else {
                    assert(false, "Invalid pin");
                }
            } else {
                assert(false, "Invalid field type");
            }

            const mask = 0b000000100000010000001000000100000010000001000000100000010000001n;
            if (l.op === "xor") {
                pols.c[r] = (pols.a[r] & mask) ^ (pols.b[r] &  mask);
            } else if (l.op === "andp") {
                pols.c[r] = ((pols.a[r]  &  mask) ^ mask) & (pols.b[r]  &  mask);
            }

        }

        offset += SlotSize;
    }

    for (let i= 1+ nSlots*SlotSize; i<N; i++) {
        pols.a[i] = 0n;
        pols.b[i] = 0n;
        pols.c[i] = 0n;
    }
}