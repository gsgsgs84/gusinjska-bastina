// Room tracking without the printed map and without Google/Apple AR services: follows the floor or table under the
// terrain. The phone's motion sensors give the camera's rotation and which way is down; points on the surface are
// tracked from frame to frame (pyramidal Lucas-Kanade optical flow from jsfeat, MIT) and give the camera's position.
//
// The surface is a horizontal plane y = planeY in the room frame (y up). Its true distance is unknown, so the room is
// rebuilt at an assumed scale; that changes only how big the terrain looks, never where it stays.
// Classic script: loaded by js/staze-room-worker.js (importScripts) and by tools/tests (Node).
/* global jsfeat */
(function (root) {
  'use strict';
  const LEVELS = 4;
  const DEFAULTS = { maxPts: 170, minPts: 70, win: 21, fb: 1.0, prior: 3, thr: 2.6, lost: 8 };      // prior: how much the sensor rotation counts, in points

  class RoomTracker {
    constructor(w, h, opts) {
      this.w = w; this.h = h;
      this.o = Object.assign({}, DEFAULTS, opts || {});
      const MAX_PTS = this.o.maxPts;
      const T = jsfeat.U8_t | jsfeat.C1_t;
      this.prev = new jsfeat.pyramid_t(LEVELS); this.prev.allocate(w, h, T);
      this.curr = new jsfeat.pyramid_t(LEVELS); this.curr.allocate(w, h, T);
      this.blur = new jsfeat.matrix_t(w, h, T);
      this.corners = []; for (let i = 0; i < w * h >> 2; i++) this.corners.push(new jsfeat.keypoint_t(0, 0, 0, 0, -1));
      this.pts = [];                // {X:[x,y,z], u, v, miss}
      this.xyA = new Float32Array(MAX_PTS * 2); this.xyB = new Float32Array(MAX_PTS * 2); this.xyC = new Float32Array(MAX_PTS * 2); this.xyG = new Float32Array(MAX_PTS * 2);
      this.st = new Uint8Array(MAX_PTS); this.st2 = new Uint8Array(MAX_PTS);
      this.R = null; this.C = null; this.planeY = 0; this.started = false; this.bad = 0;
    }

    gray(rgba, pyr) {
      jsfeat.imgproc.grayscale(rgba, this.w, this.h, pyr.data[0]);
      pyr.build(pyr.data[0], true);
    }

    // rgba: this.w x this.h; K {fx, fy, cx, cy}; R: room->camera rotation (OpenCV camera, row-major 9); C: camera centre [x,y,z]
    // R: the camera's rotation in the room; Rsensor: the raw sensor rotation at the same moment (default R)
    start(rgba, K, R, C, planeY, time, Rsensor) {
      this.gray(rgba, this.curr);
      this.R = R.slice(); this.RgKey = (Rsensor || R).slice(); this.C = C.slice(); this.planeY = planeY; this.vel = [0, 0, 0]; this.tKey = null;
      this.pts = []; this.bad = 0; this.started = true; this.tKey = time ?? null;
      this.addPoints(K);
      [this.prev, this.curr] = [this.curr, this.prev];
      return { ok: this.pts.length >= 12, n: this.pts.length };
    }

    // Rprior: room->camera rotation from the motion sensors at the moment of this frame.
    // Points are followed from the last frame that tracked well (the key frame). Their search starts where the sensor
    // rotation says they should be, so fast turns and skipped frames don't lose them; after a miss the next frame is
    // tried against the same key frame, so a short dropout doesn't cost any position.
    track(rgba, K, Rsensor, time) {
      const t0 = now();
      this.gray(rgba, this.curr);
      // the sensors' turn since the key frame, applied to the key frame's measured rotation: a constant sensor delay
      // or offset cancels out
      const Rprior = mul(Rsensor, mul(transpose(this.RgKey), this.R));
      const dt = time != null && this.tKey != null ? Math.min(0.6, Math.max(0, time - this.tKey)) : (this.bad + 1) / 30;
      const pts = this.pts, n = pts.length;
      let res = null;
      if (n >= 6) {
        // where the phone probably is: moving on at its recent speed; after a gap, also try less and more of that
        for (const f of this.bad || dt > 0.12 ? [1, 0.4, 1.7, 0] : [1]) {
          const Cp = [this.C[0] + this.vel[0] * dt * f, this.C[1] + this.vel[1] * dt * f, this.C[2] + this.vel[2] * dt * f];
          const r = this.attempt(K, Rprior, Cp);
          if (r.ok) { res = r; break; }
          if (!res || r.inl > res.inl) res = r;
        }
      }
      const ok = !!(res && res.ok);
      if (ok) {
        const { sol, obs, B, isIn } = res, C = sol.C;
        const seen = new Uint8Array(n);
        obs.forEach((i, k) => { seen[i] = 1; pts[i].u = B[2 * i]; pts[i].v = B[2 * i + 1]; pts[i].miss = isIn[k] ? 0 : pts[i].miss + 1; });
        this.pts = pts.filter((p, i) => seen[i] && p.miss < 3);
        if (dt > 0.005) for (let a = 0; a < 3; a++) this.vel[a] = 0.6 * this.vel[a] + 0.4 * (C[a] - this.C[a]) / dt;
        this.R = sol.R; this.C = C; this.bad = 0; this.RgKey = Rsensor.slice(); this.tKey = time;
        if (this.pts.length < this.o.minPts) this.addPoints(K);
        [this.prev, this.curr] = [this.curr, this.prev];          // this frame is the new key frame
      } else {
        this.bad++;
        if (this.bad >= this.o.lost) {                           // gone for good: start again from what is in view now
          // carry on from where the phone probably is now (recent speed, for at most half a second)
          const d = Math.min(dt, 0.5);
          this.C = [this.C[0] + this.vel[0] * d, this.C[1] + this.vel[1] * d, this.C[2] + this.vel[2] * d];
          this.R = Rprior; this.RgKey = Rsensor.slice(); this.tKey = time;
          this.pts = []; this.addPoints(K); this.bad = 0; this.vel = [0, 0, 0];
          [this.prev, this.curr] = [this.curr, this.prev];
        }
      }
      const inl = res ? res.inl : 0;
      return { ok, R: ok ? this.R : Rprior, C: this.C, inl, n: this.pts.length, ms: now() - t0, pts: this.pts.map(p => [p.u, p.v, p.miss ? 0 : 1]) };
    }

    // follow the points from the key frame into this frame, starting near where the pose (Rprior, Cp) puts them
    attempt(K, Rprior, Cp) {
      const pts = this.pts, n = pts.length, WIN = this.o.win;
      const A = this.xyA, B = this.xyB, Cb = this.xyC, G = this.xyG;
      const shifts = [];
      for (let i = 0; i < n; i++) {
        const p = pts[i], g = project(Rprior, Cp, K, p.X);
        A[2 * i] = p.u; A[2 * i + 1] = p.v;
        G[2 * i] = g ? g[0] : p.u; G[2 * i + 1] = g ? g[1] : p.v;
        shifts.push(Math.hypot(G[2 * i] - p.u, G[2 * i + 1] - p.v));
      }
      // a small predicted move is better left to the flow itself (the prediction has a few pixels of noise)
      const useGuess = shifts.sort((a, b) => a - b)[shifts.length >> 1] > 6 * this.w / 480;
      lkTrack(this.prev, this.curr, A, B, n, WIN, 30, this.st, 0.01, 0.0005, useGuess ? G : null);
      lkTrack(this.curr, this.prev, B, Cb, n, WIN, 30, this.st2, 0.01, 0.0005, A);      // and back again
      const obs = [];
      for (let i = 0; i < n; i++) {
        if (this.st[i] && this.st2[i] && Math.hypot(Cb[2 * i] - A[2 * i], Cb[2 * i + 1] - A[2 * i + 1]) < this.o.fb &&
          B[2 * i] > 2 && B[2 * i + 1] > 2 && B[2 * i] < this.w - 3 && B[2 * i + 1] < this.h - 3) obs.push(i);
      }
      if (typeof process !== 'undefined' && process.env && process.env.DBG) {
        let dg = 0, dp = 0; for (const i of obs) { dg += Math.hypot(B[2 * i] - G[2 * i], B[2 * i + 1] - G[2 * i + 1]); dp += Math.hypot(B[2 * i] - A[2 * i], B[2 * i + 1] - A[2 * i + 1]); }
        this.dbg = { n, obs: obs.length, guessErr: dg / Math.max(1, obs.length), motion: dp / Math.max(1, obs.length), useGuess,
          obsPts: obs.map(i => [pts[i].X, B[2 * i], B[2 * i + 1]]), Rprior, Cp };
      }
      const thr = this.o.thr * this.w / 480;
      const sol = obs.length >= 6 ? solvePose(obs.map(i => pts[i].X), obs.map(i => [B[2 * i], B[2 * i + 1]]), K, Rprior, Cp, thr, this.o.prior) : null;
      if (!sol) return { ok: false, inl: 0 };
      const inl = sol.inl.length;
      let ok = inl >= 10 && inl / obs.length >= 0.35;
      // a jump much bigger than a hand can move is a false match
      const h = Math.max(0.05, Math.abs(this.C[1] - this.planeY));
      if (ok && Math.hypot(sol.C[0] - Cp[0], sol.C[1] - Cp[1], sol.C[2] - Cp[2]) > h * 0.35 * (1 + this.bad)) ok = false;
      const isIn = new Uint8Array(obs.length); for (const k of sol.inl) isIn[k] = 1;
      return { ok, inl, sol, obs, B: B.slice(0, 2 * n), isIn };
    }

    // new surface points where there are none yet, placed on the plane with the current pose
    addPoints(K) {
      const img = this.curr.data[0], w = this.w, h = this.h;
      jsfeat.imgproc.gaussian_blur(img, this.blur, 3);
      jsfeat.yape06.laplacian_threshold = 18;
      jsfeat.yape06.min_eigen_value_threshold = 16;
      const cnt = jsfeat.yape06.detect(this.blur, this.corners, 12);
      const GX = 12, GY = Math.round(12 * h / w), cell = new Int32Array(GX * GY).fill(-1), used = new Uint8Array(GX * GY);
      for (const p of this.pts) used[Math.min(GY - 1, (p.v / h * GY) | 0) * GX + Math.min(GX - 1, (p.u / w * GX) | 0)] = 1;
      for (let i = 0; i < cnt; i++) {
        const c = this.corners[i], k = Math.min(GY - 1, (c.y / h * GY) | 0) * GX + Math.min(GX - 1, (c.x / w * GX) | 0);
        if (used[k]) continue;
        if (cell[k] < 0 || c.score > this.corners[cell[k]].score) cell[k] = i;
      }
      const R = this.R, Cc = this.C, height = Math.abs(Cc[1] - this.planeY), maxD = Math.max(0.05, height) * 7;
      const order = [];
      for (let k = 0; k < cell.length; k++) if (cell[k] >= 0) order.push(cell[k]);
      order.sort((a, b) => this.corners[b].score - this.corners[a].score);
      for (const i of order) {
        if (this.pts.length >= this.o.maxPts) break;
        const c = this.corners[i];
        // viewing ray in the room: R^T * K^-1 [u v 1]
        const x = (c.x - K.cx) / K.fx, y = (c.y - K.cy) / K.fy;
        const d = [R[0] * x + R[3] * y + R[6], R[1] * x + R[4] * y + R[7], R[2] * x + R[5] * y + R[8]];
        const len = Math.hypot(d[0], d[1], d[2]);
        if (d[1] / len > -0.17) continue;                  // must look down at the surface (more than ~10°)
        const s = (this.planeY - Cc[1]) / d[1];
        if (!(s > 0) || s * len > maxD) continue;
        this.pts.push({ X: [Cc[0] + s * d[0], this.planeY, Cc[2] + s * d[2]], u: c.x, v: c.y, miss: 0 });
      }
    }
  }

  // Pyramidal Lucas-Kanade optical flow: jsfeat's optical_flow_lk.track (MIT, (c) Eugene Zatepyakin), copied with one
  // change marked below: the search can start from a guessed position instead of the old one.
  /* eslint-disable */
  function lkTrack(prev_pyr, curr_pyr, prev_xy, curr_xy, count, win_size, max_iter, status, eps, min_eigen_threshold, guess) {
                var scharr_deriv = jsfeat.imgproc.scharr_derivatives;
                if (typeof max_iter === "undefined") { max_iter = 30; }
                if (typeof status === "undefined") { status = new Uint8Array(count); }
                if (typeof eps === "undefined") { eps = 0.01; }
                if (typeof min_eigen_threshold === "undefined") { min_eigen_threshold = 0.0001; }

                var half_win = (win_size-1)*0.5;
                var win_area = (win_size*win_size)|0;
                var win_area2 = win_area << 1;
                var prev_imgs = prev_pyr.data, next_imgs = curr_pyr.data;
                var img_prev=prev_imgs[0].data,img_next=next_imgs[0].data;
                var w0 = prev_imgs[0].cols, h0 = prev_imgs[0].rows,lw=0,lh=0;

                var iwin_node = jsfeat.cache.get_buffer(win_area<<2);
                var deriv_iwin_node = jsfeat.cache.get_buffer(win_area2<<2);
                var deriv_lev_node = jsfeat.cache.get_buffer((h0*(w0<<1))<<2);

                var deriv_m = new jsfeat.matrix_t(w0, h0, jsfeat.S32C2_t, deriv_lev_node.data);

                var iwin_buf = iwin_node.i32;
                var deriv_iwin = deriv_iwin_node.i32;
                var deriv_lev = deriv_lev_node.i32;

                var dstep=0,src=0,dsrc=0,iptr=0,diptr=0,jptr=0;
                var lev_sc=0.0,prev_x=0.0,prev_y=0.0,next_x=0.0,next_y=0.0;
                var prev_delta_x=0.0,prev_delta_y=0.0,delta_x=0.0,delta_y=0.0;
                var iprev_x=0,iprev_y=0,inext_x=0,inext_y=0;
                var i=0,j=0,x=0,y=0,level=0,ptid=0,iter=0;
                var brd_tl=0,brd_r=0,brd_b=0;
                var a=0.0,b=0.0,b1=0.0,b2=0.0;

                // fixed point math
                var W_BITS14 = 14;
                var W_BITS4 = 14;
                var W_BITS1m5 = W_BITS4 - 5;
                var W_BITS1m51 = (1 << ((W_BITS1m5) - 1));
                var W_BITS14_ = (1 << W_BITS14);
                var W_BITS41 = (1 << ((W_BITS4) - 1));
                var FLT_SCALE = 1.0/(1 << 20);
                var iw00=0,iw01=0,iw10=0,iw11=0,ival=0,ixval=0,iyval=0;
                var A11=0.0,A12=0.0,A22=0.0,D=0.0,min_eig=0.0;

                var FLT_EPSILON = 0.00000011920929;
                eps *= eps;

                // reset status
                for(; i < count; ++i) {
                    status[i] = 1;
                }

                var max_level = (prev_pyr.levels - 1)|0;
                level = max_level;

                for(; level >= 0; --level) {
                    lev_sc = (1.0/(1 << level));
                    lw = w0 >> level;
                    lh = h0 >> level;
                    dstep = lw << 1;
                    img_prev = prev_imgs[level].data;
                    img_next = next_imgs[level].data;
                    
                    brd_r = (lw - win_size)|0;
                    brd_b = (lh - win_size)|0;

                    // calculate level derivatives
                    scharr_deriv(prev_imgs[level], deriv_m);

                    // iterate through points
                    for(ptid = 0; ptid < count; ++ptid) {
                        i = ptid << 1;
                        j = i + 1;
                        prev_x = prev_xy[i]*lev_sc;
                        prev_y = prev_xy[j]*lev_sc;

                        if( level == max_level ) {
                            // changed: start from a predicted position (the phone's rotation is known) when given
                            next_x = guess ? guess[i]*lev_sc : prev_x;
                            next_y = guess ? guess[j]*lev_sc : prev_y;
                        } else {
                            next_x = curr_xy[i]*2.0;
                            next_y = curr_xy[j]*2.0;
                        }
                        curr_xy[i] = next_x;
                        curr_xy[j] = next_y;

                        prev_x -= half_win;
                        prev_y -= half_win;
                        iprev_x = prev_x|0;
                        iprev_y = prev_y|0;

                        // border check
                        x = (iprev_x <= brd_tl)|(iprev_x >= brd_r)|(iprev_y <= brd_tl)|(iprev_y >= brd_b);
                        if( x != 0 ) {
                            if( level == 0 ) {
                                status[ptid] = 0;
                            }
                            continue;
                        }

                        a = prev_x - iprev_x;
                        b = prev_y - iprev_y;
                        iw00 = (((1.0 - a)*(1.0 - b)*W_BITS14_) + 0.5)|0;
                        iw01 = ((a*(1.0 - b)*W_BITS14_) + 0.5)|0;
                        iw10 = (((1.0 - a)*b*W_BITS14_) + 0.5)|0;
                        iw11 = (W_BITS14_ - iw00 - iw01 - iw10);

                        A11 = 0.0, A12 = 0.0, A22 = 0.0;

                        // extract the patch from the first image, compute covariation matrix of derivatives
                        for( y = 0; y < win_size; ++y ) {
                            src = ( (y + iprev_y)*lw + iprev_x )|0;
                            dsrc = src << 1;

                            iptr = (y*win_size)|0;
                            diptr = iptr << 1;
                            for(x = 0 ; x < win_size; ++x, ++src, ++iptr, dsrc += 2) {
                                ival = ( (img_prev[src])*iw00 + (img_prev[src+1])*iw01 +
                                        (img_prev[src+lw])*iw10 + (img_prev[src+lw+1])*iw11 );
                                ival = (((ival) + W_BITS1m51) >> (W_BITS1m5));

                                ixval = ( deriv_lev[dsrc]*iw00 + deriv_lev[dsrc+2]*iw01 +
                                        deriv_lev[dsrc+dstep]*iw10 + deriv_lev[dsrc+dstep+2]*iw11 );
                                ixval = (((ixval) + W_BITS41) >> (W_BITS4));

                                iyval = ( deriv_lev[dsrc+1]*iw00 + deriv_lev[dsrc+3]*iw01 + deriv_lev[dsrc+dstep+1]*iw10 +
                                        deriv_lev[dsrc+dstep+3]*iw11 );
                                iyval = (((iyval) + W_BITS41) >> (W_BITS4));

                                iwin_buf[iptr] = ival;
                                deriv_iwin[diptr++] = ixval;
                                deriv_iwin[diptr++] = iyval;

                                A11 += ixval*ixval;
                                A12 += ixval*iyval;
                                A22 += iyval*iyval;
                            }
                        }

                        A11 *= FLT_SCALE; A12 *= FLT_SCALE; A22 *= FLT_SCALE;

                        D = A11*A22 - A12*A12;
                        min_eig = (A22 + A11 - Math.sqrt((A11-A22)*(A11-A22) + 4.0*A12*A12)) / win_area2;

                        if( min_eig < min_eigen_threshold || D < FLT_EPSILON )
                        {
                            if( level == 0 ) {
                                status[ptid] = 0;
                            }
                            continue;
                        }

                        D = 1.0/D;

                        next_x -= half_win;
                        next_y -= half_win;
                        prev_delta_x = 0.0;
                        prev_delta_y = 0.0;

                        for( iter = 0; iter < max_iter; ++iter ) {
                            inext_x = next_x|0;
                            inext_y = next_y|0;

                            x = (inext_x <= brd_tl)|(inext_x >= brd_r)|(inext_y <= brd_tl)|(inext_y >= brd_b);
                            if( x != 0 ) {
                                if( level == 0 ) {
                                    status[ptid] = 0;
                                }
                                break;
                            }

                            a = next_x - inext_x;
                            b = next_y - inext_y;
                            iw00 = (((1.0 - a)*(1.0 - b)*W_BITS14_) + 0.5)|0;
                            iw01 = ((a*(1.0 - b)*W_BITS14_) + 0.5)|0;
                            iw10 = (((1.0 - a)*b*W_BITS14_) + 0.5)|0;
                            iw11 = (W_BITS14_ - iw00 - iw01 - iw10);
                            b1 = 0.0, b2 = 0.0;

                            for( y = 0; y < win_size; ++y ) {
                                jptr = ( (y + inext_y)*lw + inext_x )|0;

                                iptr = (y*win_size)|0;
                                diptr = iptr << 1;
                                for( x = 0 ; x < win_size; ++x, ++jptr, ++iptr ) {
                                    ival = ( (img_next[jptr])*iw00 + (img_next[jptr+1])*iw01 +
                                            (img_next[jptr+lw])*iw10 + (img_next[jptr+lw+1])*iw11 );
                                    ival = (((ival) + W_BITS1m51) >> (W_BITS1m5));
                                    ival = (ival - iwin_buf[iptr]);

                                    b1 += ival * deriv_iwin[diptr++];
                                    b2 += ival * deriv_iwin[diptr++];
                                }
                            }

                            b1 *= FLT_SCALE;
                            b2 *= FLT_SCALE;

                            delta_x = ((A12*b2 - A22*b1) * D);
                            delta_y = ((A12*b1 - A11*b2) * D);

                            next_x += delta_x;
                            next_y += delta_y;
                            curr_xy[i] = next_x + half_win;
                            curr_xy[j] = next_y + half_win;

                            if( delta_x*delta_x + delta_y*delta_y <= eps ) {
                                break;
                            }

                            if( iter > 0 && Math.abs(delta_x + prev_delta_x) < 0.01 &&
                                            Math.abs(delta_y + prev_delta_y) < 0.01 ) {
                                curr_xy[i] -= delta_x*0.5;
                                curr_xy[j] -= delta_y*0.5;
                                break;
                            }

                            prev_delta_x = delta_x;
                            prev_delta_y = delta_y;
                        }
                    } // points loop
                } // levels loop

                jsfeat.cache.put_buffer(iwin_node);
                jsfeat.cache.put_buffer(deriv_iwin_node);
                jsfeat.cache.put_buffer(deriv_lev_node);
            }
  /* eslint-enable */

  // ---- camera pose from surface points: rotation starts from the motion sensors, position from the points ----
  function project(R, C, K, X) {
    const a = X[0] - C[0], b = X[1] - C[1], c = X[2] - C[2];
    const x = R[0] * a + R[1] * b + R[2] * c, y = R[3] * a + R[4] * b + R[5] * c, z = R[6] * a + R[7] * b + R[8] * c;
    return z > 1e-4 ? [K.fx * x / z + K.cx, K.fy * y / z + K.cy] : null;
  }
  function errs(R, C, K, X, U) {
    return X.map((x, i) => { const p = project(R, C, K, x); return p ? Math.hypot(p[0] - U[i][0], p[1] - U[i][1]) : 1e9; });
  }
  // position with known rotation, linear least squares: m x R (X - C) = 0
  function solveC(R, K, X, U, idx) {
    const M = new Float64Array(9), r = new Float64Array(3);
    for (const i of idx) {
      const m = [(U[i][0] - K.cx) / K.fx, (U[i][1] - K.cy) / K.fy, 1];
      // A = [m]x R ; b = A X
      const Rr = [[R[0], R[1], R[2]], [R[3], R[4], R[5]], [R[6], R[7], R[8]]];
      const sk = [[0, -m[2], m[1]], [m[2], 0, -m[0]], [-m[1], m[0], 0]];
      for (let a = 0; a < 3; a++) {
        const row = [0, 1, 2].map(j => sk[a][0] * Rr[0][j] + sk[a][1] * Rr[1][j] + sk[a][2] * Rr[2][j]);
        const b = row[0] * X[i][0] + row[1] * X[i][1] + row[2] * X[i][2];
        for (let p = 0; p < 3; p++) { r[p] += row[p] * b; for (let q = 0; q < 3; q++) M[p * 3 + q] += row[p] * row[q]; }
      }
    }
    return solve(M, r, 3);
  }
  function solvePose(X, U, K, R0, Cprev, thr, prior) {
    const n = X.length, all = [...Array(n).keys()];
    let best = null, bestN = -1;
    // hypotheses: from 3 random points, position and rotation together (the predicted pose may be some pixels off)
    const score = (R, C) => { if (!R || !C) return; const e = errs(R, C, K, X, U); let c = 0; for (let i = 0; i < n; i++) if (e[i] < thr * 3) c++; if (c > bestN) { bestN = c; best = { R, C }; } };
    score(R0, Cprev);
    for (let it = 0; it < 40; it++) {
      const idx = [];
      while (idx.length < 4) { const k = (rand() * n) | 0; if (!idx.includes(k)) idx.push(k); if (n < 5) break; }
      let R = R0.slice(), C = solveC(R0, K, X, U, idx);
      if (!C) continue;
      ({ R, C } = refine(R, C, K, X, U, idx, R0, 0.3, 6));
      if (angle(R, R0) < 8) score(R, C);
    }
    if (bestN < 4) return null;
    // grow the inlier set: refine on it, take the points that now fit, refine again
    let R = best.R, C = best.C, e, inl = [], prevN = -1;
    for (let pass = 0; pass < 5; pass++) {
      e = errs(R, C, K, X, U); inl = all.filter(i => e[i] < thr * 2);
      if (inl.length <= prevN || inl.length < 8) break;
      prevN = inl.length;
      ({ R, C } = refine(R, C, K, X, U, inl, R0, prior, 4));
    }
    for (let it = 0; it < 2 && inl.length >= 8; it++) {            // final polish on the close fits
      e = errs(R, C, K, X, U); const tight = all.filter(i => e[i] < thr * 1.2);
      if (tight.length < 8) break;
      ({ R, C } = refine(R, C, K, X, U, tight, R0, prior, 3));
    }
    e = errs(R, C, K, X, U); inl = all.filter(i => e[i] < thr);
    if (angle(R, R0) > 6) { R = R0.slice(); C = solveC(R0, K, X, U, inl) || C; e = errs(R, C, K, X, U); inl = all.filter(i => e[i] < thr); }
    return { R, C, inl };
  }
  // Levenberg-Marquardt on the points idx (Huber), with the rotation held near the sensors' R0 by `prior`
  function cost(R, C, K, X, U, idx, R0, prior) {
    let c = 0;
    for (const i of idx) { const p = project(R, C, K, X[i]); if (!p) { c += 1e4; continue; } const r = Math.hypot(p[0] - U[i][0], p[1] - U[i][1]); c += r < HUBER ? r * r : 2 * HUBER * r - HUBER * HUBER; }
    const d = Math.hypot(...rotDelta(R0, R));
    return c + prior * K.fx * K.fx * (d < PRIOR_TAU ? d * d : 2 * PRIOR_TAU * d - PRIOR_TAU * PRIOR_TAU);
  }
  function refine(R, C, K, X, U, idx, R0, prior, iters) {
    let lam = 1e-3, cur = cost(R, C, K, X, U, idx, R0, prior);
    for (let it = 0; it < iters; it++) {
      const st = gaussNewton(R, C, K, X, U, idx, R0, prior, lam);
      if (!st) break;
      const c2 = cost(st.R, st.C, K, X, U, idx, R0, prior);
      if (c2 < cur) { R = st.R; C = st.C; const gain = cur - c2; cur = c2; lam = Math.max(1e-6, lam * 0.3); if (gain < 1e-3) break; }
      else { lam *= 10; if (lam > 1e3) break; }
    }
    return { R, C };
  }
  function gaussNewton(R, C, K, X, U, idx, R0, prior, lam = 1e-3) {
    const H = new Float64Array(36), g = new Float64Array(6);
    for (const i of idx) {
      const a = X[i][0] - C[0], b = X[i][1] - C[1], c = X[i][2] - C[2];
      const P = [R[0] * a + R[1] * b + R[2] * c, R[3] * a + R[4] * b + R[5] * c, R[6] * a + R[7] * b + R[8] * c];
      if (P[2] < 1e-3) continue;
      const iz = 1 / P[2], u = K.fx * P[0] * iz + K.cx, v = K.fy * P[1] * iz + K.cy;
      const ru = u - U[i][0], rv = v - U[i][1];
      const w = Math.hypot(ru, rv) > HUBER ? HUBER / Math.hypot(ru, rv) : 1;          // Huber
      const dU = [K.fx * iz, 0, -K.fx * P[0] * iz * iz], dV = [0, K.fy * iz, -K.fy * P[1] * iz * iz];
      // dP/dw = -[P]x , dP/dC = -R
      const dPw = [[0, P[2], -P[1]], [-P[2], 0, P[0]], [P[1], -P[0], 0]];
      const Ju = new Array(6), Jv = new Array(6);
      for (let k = 0; k < 3; k++) {
        Ju[k] = dU[0] * dPw[0][k] + dU[1] * dPw[1][k] + dU[2] * dPw[2][k];
        Jv[k] = dV[0] * dPw[0][k] + dV[1] * dPw[1][k] + dV[2] * dPw[2][k];
        Ju[3 + k] = -(dU[0] * R[k] + dU[1] * R[3 + k] + dU[2] * R[6 + k]);
        Jv[3 + k] = -(dV[0] * R[k] + dV[1] * R[3 + k] + dV[2] * R[6 + k]);
      }
      for (let p = 0; p < 6; p++) { g[p] -= w * (Ju[p] * ru + Jv[p] * rv); for (let q = 0; q < 6; q++) H[p * 6 + q] += w * (Ju[p] * Ju[q] + Jv[p] * Jv[q]); }
    }
    // prior: the rotation stays near the motion sensors (worth `prior` points)
    // robust too: the sensors are trusted for small differences, a larger one is left to the picture
    const d = rotDelta(R0, R), dn = Math.hypot(d[0], d[1], d[2]), wp = prior * K.fx * K.fx * (dn > PRIOR_TAU ? PRIOR_TAU / dn : 1);
    for (let k = 0; k < 3; k++) { H[k * 6 + k] += wp; g[k] -= wp * d[k]; }
    for (let k = 0; k < 6; k++) H[k * 6 + k] *= 1 + lam;
    const x = solve(H, g, 6);
    if (!x) return null;
    const Rn = mul(expm([x[0], x[1], x[2]]), R);
    return { R: Rn, C: [C[0] + x[3], C[1] + x[4], C[2] + x[5]] };
  }
  // small rotation w with R ≈ exp(w) R0 ... here: w such that R = exp(w) R0, returned for R relative to R0
  function rotDelta(R0, R) {
    const D = mul(R, transpose(R0));
    return [(D[7] - D[5]) / 2, (D[2] - D[6]) / 2, (D[3] - D[1]) / 2];
  }
  function expm(w) {
    const th = Math.hypot(w[0], w[1], w[2]);
    if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const k = [w[0] / th, w[1] / th, w[2] / th], c = Math.cos(th), s = Math.sin(th), v = 1 - c;
    return [c + k[0] * k[0] * v, k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s,
      k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v, k[1] * k[2] * v - k[0] * s,
      k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v];
  }
  function mul(A, B) {
    const o = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    return o;
  }
  function transpose(A) { return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]]; }
  function angle(A, B) {
    let tr = 0; for (let i = 0; i < 9; i++) tr += A[i] * B[i];
    return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI;
  }
  function solve(Ain, bin, n) {
    const A = Array.from(Ain), b = Array.from(bin);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
      if (Math.abs(A[p * n + c]) < 1e-15) return null;
      if (p !== c) { for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; } const t = b[c]; b[c] = b[p]; b[p] = t; }
      for (let r = c + 1; r < n; r++) { const f = A[r * n + c] / A[c * n + c]; for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k]; b[r] -= f * b[c]; }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k]; x[r] = s / A[r * n + r]; }
    return x.every(Number.isFinite) ? x : null;
  }
  const HUBER = 3, PRIOR_TAU = 0.6 * Math.PI / 180;
  let seed = 12345;                 // repeatable random samples
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  root.RoomTracker = RoomTracker;
  RoomTracker.internals = { solvePose, errs, solveC, gaussNewton, refine };       // for tests
})(typeof self !== 'undefined' ? self : globalThis);
