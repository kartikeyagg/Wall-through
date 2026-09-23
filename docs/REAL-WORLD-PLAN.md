# Taking Wall Through into the real world

This is the plan for two things:

1. **The real system**: what hardware each officer and each thrown puck carries, and the software that runs on it.
2. **A realistic simulator on this laptop**: how to make the simulator behave like that real system while still running without lag here.

How to read the numbers:

- A number with a link was checked against that source on 22 September 2026. The links are collected in [Sources](#sources).
- *(measured)* means it was measured on this laptop while writing this plan.
- *(est.)* means an engineering estimate. Each one should be replaced by a measurement in the phase that produces it.

---

## 1. Where this stands

The simulator already gets the stereo optics right. Its default rig is 8 cm baseline, 1280×720 and 117° HFOV, with 0.15 px matching noise. That is within a few percent of a real off-the-shelf head camera, the Luxonis OAK-D Pro W: 7.5 cm baseline, 1280×800, 127° HFOV, global shutter ([Luxonis](https://docs.luxonis.com/hardware/products/OAK-D%20Pro%20W)). The simulator's σ = depth² × σd / (f × B) gives about 1.9% error at 4 m. Luxonis measures under 2% below 4 m on the OAK-D Pro ([Luxonis](https://docs.luxonis.com/hardware/platform/depth/depth-accuracy)).

The plumbing is also the right shape for real hardware:

- the provider seam in `src/sensors.js`
- the skeleton publish and subscribe path
- the detector bypass
- the lapsing clearance

What the simulator does **not** yet model are the five problems that will decide whether the real system works:

1. **A shared coordinate frame indoors.** Every teammate outline is only as good as two officers' self-localization. The simulator's self-localization is close to perfect (§2). Real indoor localization is the hardest part of this project.
2. **Who is who.** Real detections carry no identity. The simulator's detections carry the ground-truth person id.
3. **The network and clocks.** Teammate data arrives late, out of order, and sometimes not at all. In the simulator it arrives instantly, on one shared clock.
4. **AR registration.** A see-through display must redraw at display rate from local head tracking. Otherwise overlays swim as the head turns.
5. **Radar realism.** A real 24 GHz chip covers about 76° azimuth × 19° elevation, not 240°. Infineon's Position2Go reference board tracks people to about 12 m under typical settings, not 18 m. A single drywall sheet costs about 1.2 dB one way near 28 GHz, the closest measured band to 24 GHz ([arXiv](https://arxiv.org/pdf/2004.12568)), and an echo crosses it twice. The simulator charges 7.5 dB once. Returns come as a noisy point cloud with ghost points, not one clean point per person.

The plan is to build the real system in phases R0–R6 (§3.7). In parallel, the simulator gets the same five problems in phases S0–S9 (§4.8). Each real phase then produces measured parameters that replace the simulator's guesses (§3.8).

---

## 2. What the simulator assumes that reality will not give you

| # | Area | What the simulator does now | What the real world does | Why it matters |
| --- | --- | --- | --- | --- |
| 1 | **Self-localization** | `SelfLocalization` in `sensors.js` adds a sinusoid to the **true** pose. Over two simulated minutes the error stays at 3.9 cm median, 8 cm worst, and 0.69° worst yaw *(measured)*. It does not grow with distance walked, and it is the same with the IMU on or off *(measured)*. | Visual-inertial odometry (VIO) drifts with distance and rotation. The best stereo VIO reaches under 1% trajectory error on KITTI driving data ([cuVSLAM](https://arxiv.org/html/2506.04359v2)); a head-mounted camera indoors is harder. | A target's shared position inherits the observer's pose error. An outline painted behind a wall can be off by more than the wall's thickness. |
| 2 | **Compass** | Compass yaw error is ±0.012 rad (0.7°). | Near ferromagnetic objects and electronics, magnetometer heading errors of up to 180° have been reported ([review](https://pmc.ncbi.nlm.nih.gov/articles/PMC9605636/), citing Bachmann 2004). | The sim leans on the compass for heading. Indoors it cannot be the primary heading source. It must be gated and outlier-rejected. |
| 3 | **IMU** | The "IMU" is the finite-difference **true** velocity plus a sinusoid. | A real IMU measures angular rate and specific force, both with drifting bias. Integrated alone, position error grows quickly. Foot-mounted zero-velocity (ZUPT) dead reckoning reaches about 1 m after 100 m with industrial-grade sensors ([ref](https://bpb-us-e2.wpmucdn.com/faculty.sites.uci.edu/dist/e/700/files/2020/11/GNSS20-0148.pdf)). | The simulated IMU secretly knows the truth. |
| 4 | **Back-projection** | `detectWith` and `cameraSkeleton` in `vision.js` call `officerPose(officer, rig)` with the officer's **true** position and heading. | The real rig can only back-project through its own *estimated* pose. | A 1° heading error puts a target 10 m away 17 cm sideways. A 0.5 m position error moves it 0.5 m. The sim hides this completely. |
| 5 | **Identity** | Every detection carries `trackId: target.id`, the ground-truth id (`vision.js` line 252). | Detections are anonymous. The team must associate them across frames and across officers, which brings ID switches, merged tracks and split tracks. | This is the largest ground-truth leak. Fused tracks, skeleton ownership and clearances all key on that id. |
| 6 | **Teammates** | The detector only sees `world.targets` (`vision.js` line 227). Officers are invisible to it. | A real detector sees teammates too. They must be suppressed by matching detections against teammates' *estimated* poses (blue-force filtering). | With localization error, a teammate standing next to a suspect can be mis-labelled. That is a fratricide and mis-identification risk. |
| 7 | **Occlusion** | Only walls block sight. | People block each other, and so does furniture. | Crowded rooms produce partial poses and missed people. |
| 8 | **Detector errors** | No false positives. A person inside the gates is always found. | Detectors miss people and hallucinate them (posters, mannequins, reflections). Pose keypoints get unreliable when a person is small in frame: under about 100 px tall *(est.)*, against the sim's 32 px gate. | Clearing false positives is a core workflow. It needs false positives to exist. |
| 9 | **Network** | Every officer's data is available to every other officer instantly and perfectly. | Wi-Fi or a mesh radio adds latency, jitter and loss, gets worse through walls, and can partition. | "Shared vision" is really "shared, delayed, sometimes missing vision". |
| 10 | **Clocks** | One world clock. | Each device has its own clock. NTP on a LAN reaches about 1 ms; PTP with hardware timestamps does better ([ref](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html/configuring_time_synchronization/chrony-with-hw-timestamping)). | Timestamp error × target speed = position error. At 1.5 m/s, 100 ms costs 15 cm. |
| 11 | **Fusion** | `fuseMeasurements` in `tracking.js` does inverse-variance fusion, which assumes independent errors. | Reports from one officer share that officer's pose error. Relayed tracks get counted twice. Unknown correlations make naive fusion over-confident ([covariance intersection](https://www.researchgate.net/publication/379474850_A_Quarter_Century_of_Covariance_Intersection_Correlations_Still_Unknown_Lecture_Notes)). | The fused uncertainty ring shrinks when it should not. |
| 12 | **Radar field of view and range** | One puck covers 240° out to 18 m (`mmwave.js` defaults). | The Infineon **BGT24MTR12** (Position2Go reference board) gives a measured 3 dB beamwidth of about 76° azimuth × 19° elevation, with FMCW range, speed and angle-of-arrival over a single TX / two RX. Default detection runs 0.9–25 m, with people reliably tracked to about 12 m ([Infineon AN553](https://community.infineon.com/gfawx74859/attachments/gfawx74859/XMC/11081/1/Infineon-AN553_BGT24MTR12_XMC4700_Position2Go_DemoBoard-ApplicationNotes-v01_03-EN.pdf)). It has no built-in multi-person tracking firmware comparable to TI's 20-person design; that association logic has to be written. | A single-chip puck sees a sliver of what the sim shows, and narrower in elevation than azimuth. 360° coverage needs several boards. |
| 13 | **Radar through walls** | `returnStrengthDb` subtracts 7.5 dB **once** per wall. | No NIST measurement exists at exactly 24 GHz. The closest measured band is 28 GHz, where a single 13.1 mm drywall sheet cost **1.23 dB one way** at normal incidence ([arXiv](https://arxiv.org/pdf/2004.12568)) — far less than the 11.8–31.6 dB NIST measured for a full plasterboard assembly at 60.5 GHz ([NIST](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=929131)), which is why lower frequencies were chosen. A radar echo crosses the wall twice, and metal studs and oblique angles will cost more than a single sheet at normal incidence. R5 must measure a real wall assembly at 24 GHz before trusting this number. | Through-wall reach should be *better* than the sim's number for typical drywall, but the single-sheet, normal-incidence figure is optimistic next to a real stud wall. |
| 14 | **Radar returns** | One clean return per moving body. | A point cloud with several points per person, multipath ghosts near walls, and static-clutter removal that fades stationary people out ([ref](https://pmc.ncbi.nlm.nih.gov/articles/PMC12158235/)). | Ghost tracks and missing tracks both need modelling. The existing `minSpeed` dropout is a good start. |
| 15 | **Puck orientation** | The radar reads the puck's true `sensor.angle`; the code comment says "the compass gives yaw directly" (`vision.js` line 528). | A puck on the floor sits exactly where magnetometers are worst (item 2). | Puck yaw error rotates every radar track around the puck. |
| 16 | **Head motion** | Pitch and roll are always 0, and the eyes stay level. | Heads pitch, roll, bob and turn fast, which brings motion blur and AR swim. | `stereo.js` already accepts pitch and roll; nothing drives them yet. |
| 17 | **Lighting** | Every room is lit. | Tactical entries often happen in the dark. The OAK-D Pro W has an IR dot projector and an IR flood light, up to 1 W each ([Luxonis](https://docs.luxonis.com/hardware/products/OAK-D%20Pro%20W)). Active stereo works at short range; VIO in the dark struggles. | Detection range and localization both drop in the dark. |
| 18 | **Floor plan** | The minimap assumes walls are known before entry. | Plans are often missing or wrong. | The real system needs live mapping from stereo depth, or pre-loaded plans with an alignment step. |

**What the simulator already gets right:**

- the stereo depth-error law and its numbers
- the camera frame-rate model and the coasting between exposures
- common-mode depth error across a body
- the rule that a pose requires a camera
- the rule that a clearance lapses when the person leaves sight
- radar dropout of people who stop moving
- keeping ground truth away from threat judgement

Keep all of these unchanged.

---

## 3. The real system

### 3.1 Architecture

```text
 OFFICER NODE (×5–10)                                     THROWN PUCK (×4 per kit)
 ┌───────────────────────────────────────────┐            ┌──────────────────────────────┐
 │ Helmet: stereo cam + IMU (OAK-D Pro W)    │            │ 24 GHz radar ×1–3 (BGT24MTR12)│
 │         see-through display (AR glasses)  │            │ MCU + Wi-Fi/mesh (ESP32-S3)   │
 │         UWB tag (DW3000)                  │            │ IR/AprilTag marker, UWB tag   │
 │ Vest:   Jetson Orin NX 16 GB, battery,    │            │ IMU (self-righting, tilt/yaw) │
 │         mesh radio                        │            │ battery, rugged self-righting │
 │                                           │            │ shell; doubles as mesh relay  │
 │ perception → self-pose (VIO) → 3D people  │            └──────────────┬───────────────┘
 │ → local tracks → publish                  │                           │ radar tracks
 │ receive teammates → fuse → render overlay │                           │ (point cloud opt.)
 └──────────────────────┬────────────────────┘                           │
                        │     structured data only, never video          │
                        ▼                                                ▼
            ┌───────────────────────────────────────────────────────────────┐
            │ TEAM BUS: Zenoh over Wi-Fi 6 / 802.11s mesh → tactical MANET  │
            │ topics: poses, detections, skeletons, radar, threat events    │
            └───────────────────────────┬───────────────────────────────────┘
                                        ▼
                     COMMANDER: ATAK plugin (Cursor-on-Target) / web dashboard
```

**Share structured data, never video.** One skeleton is 18 joints × (x, y, z, score) at 4 bytes each, plus a header: about 350 bytes. Ten officers × three people × 15 Hz comes to about 160 KB/s for the whole team *(est.)*. That fits a congested mesh; video does not.

### 3.2 Per-officer kit (prototype)

| Part | Recommended first choice | Verified specs | Why | Alternatives |
| --- | --- | --- | --- | --- |
| Head stereo camera | **Luxonis OAK-D Pro W** | 2× OV9282 global shutter, 1280×800, 127° HFOV, 7.5 cm baseline, about 0.7–12 m ideal depth range. IR dot projector and flood light. BNO086 9-axis IMU. 2.5–3 W while streaming. On-chip stereo depth ([Luxonis](https://docs.luxonis.com/hardware/products/OAK-D%20Pro%20W)). | Nearly the simulator's default rig, so the simulator carries over directly. Depth is computed on the camera. It works in the dark at short range. | **OAK 4 D**: RVC4 chip, 48 INT8 TOPS, runs Linux, 10–15 W average ([Luxonis](https://docs.luxonis.com/hardware/platform/rvc/rvc4)). The pose model could run on the camera. **RealSense D455/D435i**: RealSense spun out of Intel in July 2025 and still sells them ([Intel Capital](https://www.intelcapital.com/realsense-completes-spin-out-from-intel-raises-50-million-to-accelerate-ai-powered-vision-for-robotics-and-biometrics/)). |
| Compute | **NVIDIA Jetson Orin NX 16 GB.** An Orin Nano Super 8 GB is fine for the R1 bench rig. | Orin Nano Super: 67 sparse INT8 TOPS, US$249 dev kit ([NVIDIA](https://developer.nvidia.com/blog/nvidia-jetson-orin-nano-developer-kit-gets-a-super-boost/)). JetPack 6 is Ubuntu 22.04 based, so it runs ROS 2 Humble. The cuVSLAM authors ran an Orin Nano Super at 25 W: stereo odometry at 640×360 and 30 fps worked, but one depth mode was stable only at 424×240, with a 31 ms call time against a 33 ms frame budget ([paper](https://arxiv.org/html/2506.04359v2)). | VIO alone nearly fills an Orin Nano, which leaves no room for the pose model. A bigger module, or moving pose inference onto the camera, fixes that. | **OAK 4 D** (pose on the camera) plus an Orin Nano for VIO |
| Pose model | **RTMPose-s via rtmlib**, exported to TensorRT on the Jetson | Apache-2.0 ([rtmlib](https://github.com/Tau-J/rtmlib)). Its `to_openpose=True` output is 18 joints in exactly the order of `KEYPOINTS` in `skeleton.js` *(measured)*. | The licence allows commercial use, and it drops straight into the existing wire format. | **YOLO26-pose**: 17 keypoints, 57.2 mAP for the nano model, but AGPL-3.0 or a paid Enterprise licence ([Ultralytics](https://docs.ultralytics.com/models/yolo26)). **RTMO** is faster for crowds of more than 4 people ([paper](https://arxiv.org/html/2312.07526v1)). |
| Ranging | **Qorvo DW3000 UWB module** | Centimetre-level in line of sight. When obstructed, the range error is always an over-estimate and can reach a few metres ([ref](https://pmc.ncbi.nlm.nih.gov/articles/PMC9657962/), measured on the older DW1000). Measure the DW3000's error through your own walls in R3. | Officer-to-officer and officer-to-puck ranges give the pose graph drift-free constraints. Gate the obstructed ranges. | None needed at this stage. |
| Display | **Phase R3: a handheld phone or tablet.** **Phase R4: XREAL One Pro** or similar optical see-through glasses. | XREAL One Pro: 57° FOV, 87 g, USB-C ([XREAL](https://www.xreal.com/us/one-pro)). HoloLens 2 production has ended and its support ends 31 Dec 2027 ([UploadVR](https://www.uploadvr.com/microsoft-discontinuing-hololens-2/)), so do not build on it. | Start with a 2D display to prove the data path. The glasses' 57° FOV is narrower than the camera's 127°, which makes the simulator's direction arrows essential. | The Jetson dev kit's display output is DisplayPort, not USB-C alt mode. Check the adapter chain with the exact glasses before buying *(unverified)*. |
| Radio | **Phase R3: Wi-Fi 6 AP or OpenWrt 802.11s mesh.** **Phase R6: tactical MANET.** | Silvus StreamCaster uses TDMA for deterministic latency; Doodle Labs Mesh Rider runs BATMAN ([ref](https://uas-forge.com/mesh-guide/)). | Wi-Fi is cheap for the lab. MANET radios are what work inside real buildings. | Pucks double as relay "breadcrumbs". |
| Power | 99 Wh vest battery | Compute 7–25 W, camera 2.5–7.5 W, display and radio a few watts: about 15–35 W in total *(est.)*. | Roughly 3–6 hours of runtime *(est.)*. | None. |

### 3.3 Thrown puck (prototype)

- **Radar.** Start with an Infineon **BGT24MTR12** on the **Position2Go** reference board (24 GHz ISM band, ~76° × 19° 3 dB beamwidth, FMCW range/speed/angle-of-arrival over USB; [Infineon AN553](https://community.infineon.com/gfawx74859/attachments/gfawx74859/XMC/11081/1/Infineon-AN553_BGT24MTR12_XMC4700_Position2Go_DemoBoard-ApplicationNotes-v01_03-EN.pdf)). Unlike TI's 60 GHz parts, it ships without multi-person tracking firmware, so the point-cloud-to-track association has to be written in-house from range-Doppler-angle data. Covering 360° takes several boards given the narrow beamwidth. The lower ISM band trades FOV and off-the-shelf tracking firmware for better wall penetration (§2, item 13).
- **Controller.** An ESP32-S3 or Raspberry Pi Zero 2 W reads the radar's UART and publishes tracks on the team bus *(est.; either works)*.
- **Knowing where it landed.**
  - an IR LED or AprilTag marker on top, which matches the simulator's marker-geolocation model exactly
  - a UWB tag ranging to the thrower
  - an IMU for tilt and for yaw relative to the throw
- **Mechanics.** A self-righting shell so the radar ends up facing horizontally. The radome must be transparent at 24 GHz, which constrains its material and thickness *(est.; test it)*.
- **Reference product.** Bounce Imaging's Explorer is a throwable 360° camera ball already used by police ([Bounce Imaging](https://bounceimaging.com/products/explorer-2-0-tactical-audio-edition/)). It is a useful benchmark for size, durability and runtime.

### 3.4 What replaces each simulator module

| Simulator module | Real replacement | Library or approach |
| --- | --- | --- |
| `stereo.js` (optics) | Camera driver and calibration | `depthai-ros` driver. The factory calibration covers the stereo pair; camera-to-IMU extrinsics need Kalibr or OpenCV. Keep `stereo.js` as the error model and fit its parameters to measurements. |
| `vision.js` detect | Pose model on the rectified left image. Stereo depth sampled over the torso gives one common-mode depth per body, exactly as `SKELETON.md` argues. Lift to 3D, then transform to world through the **estimated** pose with covariance propagated. | rtmlib / TensorRT on the Jetson |
| `tracking.js` | **Per officer:** image-space association (ByteTrack-style) plus a 3D Kalman filter. Use IMM or constant-acceleration models for people who turn on the spot. **Team level:** association by Mahalanobis gating, optionally with appearance re-identification embeddings, then fusion with **covariance intersection** for relayed tracks. | Own code; the existing `MotionTracker` is the starting point |
| `sensors.js` SelfLocalization | **Stereo-inertial VIO:** Isaac ROS Visual SLAM (cuVSLAM) ([NVIDIA](https://github.com/NVIDIA-ISAAC-ROS/isaac_ros_visual_slam)). Alternatively OpenVINS or Basalt; Basalt is what DepthAI v3's VIO node uses ([Luxonis](https://docs.luxonis.com/software-v3/depthai/release-notes)). **Shared frame:** an AprilTag board at the entry point defines `world`. Multi-agent map merging (COVINS-G, Swarm-SLAM; [ref](https://arxiv.org/pdf/2301.07147)) and UWB ranges add constraints. The compass is only a gated prior. | ROS REP-105 frames: `world` → `map` → `odom` → `base_link` |
| `mmwave.js` | Own range-Doppler-angle point-cloud extraction and person-track association on the puck, since the 24 GHz board has no equivalent to TI's people-tracking firmware. Keep the existing EKF, gating and radar-to-stereo association on the team side; they are already written for real measurements. | Own code |
| `overlay.js` | The AR renderer takes head pose from local VIO at display rate. It predicts each teammate's skeleton forward by its data age, then draws. In hardware the camera and display paths are physically separate, so the detector bypass holds by construction. Keep the `detectorInput` invariant for any composited recording. | Own code |
| `classification.js` | A replicated registry. Each entry carries revision, officer and timestamp, and merges last-writer-wins by revision. Keep an append-only audit log on every node. Surface disagreements; never silently resolve them. | Own code |
| `Minimap.tsx` | Commander view: an ATAK plugin speaking Cursor-on-Target. ATAK-CIV has been open source since 2020 ([ref](https://en.wikipedia.org/wiki/Android_Team_Awareness_Kit)); pytak (Python) and cotxml (JavaScript) exist ([ref](https://corvusintell.com/blog/field-apps/open-source-tak-ecosystem-guide/)). | ATAK / pytak |

**Middleware.**

- **ROS 2 Humble** on every node. It matches Ubuntu 22.04 on both JetPack 6 and this laptop, and is supported until May 2027 ([ROS](https://docs.ros.org/en/humble/Releases/End-of-Life.html)). Plan the move to Jazzy on Ubuntu 24.04 before then.
- **Zenoh** between devices, via `ros-humble-rmw-zenoh-cpp` ([rmw_zenoh](https://github.com/ros2/rmw_zenoh)). DDS multicast discovery over Wi-Fi meshes is a known pain point.
- Zenoh caveats:
  - multicast scouting is off by default, so run a router
  - Humble and newer distros silently drop each other's messages, so **pin one distro for the whole team**

### 3.5 The message contract, shared by simulator and hardware

Define this **before** any hardware arrives. It is what lets the simulator exercise the real software (Tier C, §4.6).

| Topic | Type | Rate | Fields |
| --- | --- | --- | --- |
| `/officer/<id>/pose` | `PoseWithCovarianceStamped` | 30 Hz | 6-DoF pose in `world`, 6×6 covariance, fix quality, sources |
| `/officer/<id>/people` | `PersonArray3D` (custom) | Per exposure | Anonymous local track id, 3D centroid and covariance, velocity, detector confidence, `sensor` |
| `/officer/<id>/skeletons` | `Skeleton18Array` (custom) | Per exposure | Local track id, 18 × (x, y, z, score, visible) in OpenPose order, shared body covariance |
| `/puck/<id>/state` | custom | 5 Hz | Located flag, estimated pose and covariance, fix count, owner, battery |
| `/puck/<id>/tracks` | custom | 10–20 Hz | Radar tracks (range, bearing, Doppler, covariance), optional point cloud |
| `/team/threat` | custom, reliable QoS | On event | Track key, state, officer, revision, reason, timestamp |
| `/team/heartbeat` | custom | 1 Hz | Clock offset, link quality, battery, software version |

Every message carries a **source timestamp**, taken at exposure time rather than send time, plus the sender's clock-offset estimate.

### 3.6 Latency budget (target)

| Stage | Budget | Notes |
| --- | --- | --- |
| Exposure → frame on host | 10–20 ms *(est.)* | Global shutter; depth computed on the camera |
| Pose inference | 10–25 ms *(est.)* | RTMPose-s, TensorRT, Orin NX, 1–3 people, sharing the GPU with VIO |
| 3D lift, local track, publish | < 5 ms *(est.)* | |
| Network, per mesh hop | 5–30 ms *(est.)* | Measure in R3 |
| Team fusion | < 5 ms *(est.)* | |
| **Age of teammate data at the display** | **≤ 150 ms target** | Predict forward by the age and show the uncertainty growth |
| Head-motion-to-photon, local | **≤ 20 ms** | The accepted VR target; see-through AR wants less ([ref](https://vrarwiki.com/wiki/Motion-to-photon_latency)). Only possible if head pose is local. |

### 3.7 Build phases

| Phase | Goal | Work | Exit criterion |
| --- | --- | --- | --- |
| **R0** Requirements and legal (1–2 wk) | Decide what "working" means | Scenarios; accuracy targets (for example, target error < 0.5 m at 10 m, heading < 2°, data age < 150 ms *(proposed)*); legal and radio-licensing review (§5); budget | Signed-off requirements, and the §3.5 contract frozen at v0 |
| **R1** One rig on the bench | 3D skeletons from real pixels | OAK-D Pro W and Jetson; pose model; stereo lift; log to MCAP; measure GPU headroom with VIO running at the same time | Centroid error against tape-measured truth at 1–12 m within 30% of the simulator's σ curve. Latency measured. |
| **R2** Self-localization | Know where the head is | cuVSLAM stereo-inertial on a helmet; walk closed loops of 50–200 m; AprilTag entry anchor; dark and low-texture tests | Drift reported as % of distance and °/min. Re-anchoring works. The numbers go into the simulator (§3.8). |
| **R3** Two officers, one frame | Shared vision works | Zenoh, chrony, a shared anchor, cross-officer association, handheld display | A person seen only by A appears on B's display. Position error and data age measured. |
| **R4** AR glasses | World-locked overlays | Display-rate reprojection from local VIO; registration calibration | Registration error under 2° while walking *(proposed)*. No visible swim during head turns. |
| **R5** Radar puck | Through-wall tracks | BGT24MTR12 Position2Go EVK, controller, marker, UWB; drywall, brick and metal-stud walls | Measured range through 0, 1 and 2 walls, ghost rate, stationary dropout time, and localization error. The simulator's radar model is re-fit to them. |
| **R6** Team scale and field trials | 5–10 officers in a training building | Mesh radios; smoke, dark and glare; failure drills (radio loss, camera loss, puck loss) | Tracking metrics (IDF1 / GOSPA) and clearance-error rates recorded per trial |

### 3.8 The calibration loop

The simulator is only as realistic as its parameters. Every real phase writes a parameter file, `simulator/params/<area>.json`. Each value in it records its provenance: a trial ID or a source link.

The simulator loads those files instead of hard-coded defaults. A parameter without provenance is flagged in the UI as a guess.

---

## 4. A realistic simulator on this laptop

### 4.1 What this machine can and cannot do

| Item | Value |
| --- | --- |
| CPU | Intel i5-9300H, 4 cores / 8 threads, 4.1 GHz max *(measured)* |
| RAM | 7.6 GB. Only 1.5 GB was free during measurement, with 2.6 GB of swap in use; Firefox and Eclipse held about 25% *(measured)*. |
| GPUs | Intel UHD 630 drives the display. The GTX 1050 Ti Max-Q (4 GB, Pascal sm_61, driver 580) is idle *(measured)*. |
| Disk | `/home` has 5.4 GB free (95% full). `/` has 23 GB free *(measured)*. |
| Simulator core today | 0.49 ms mean, 1.19 ms p99 per 60 Hz tick with 10 officers and 4 located pucks: about 3% of a frame *(measured)* |
| Rendering today | 59 fps at 1920×1080 on **both** GPUs, in overview and glasses views, with 10 officers: capped by vsync, so no lag today *(measured, GPU-backed headless Chromium)* |
| Pose model on the CPU | On a 640×400 frame with 2 people, 4 threads: **OpenVINO: 66 ms for RTMPose lightweight (about 15 fps)**. ONNX Runtime: 85 ms. RTMO-s: 155 ms *(measured)* |
| Pose model on the GPU | **Not practical here.** The stock `onnxruntime-gpu` 1.23.2 CUDA provider only contains sm_70–sm_90 kernels *(measured by inspecting the wheel)*. OpenVINO reaches the 1050 Ti through OpenCL, but ran RTMPose 3.7× slower than the CPU and failed on RTMO *(measured)*. TensorRT 10 needs SM 7.5+ ([NVIDIA](https://docs.nvidia.com/deeplearning/tensorrt/latest/getting-started/support-matrix.html)). PyTorch dropped Pascal from its cu128+ wheels; the cu126 wheels still carry it ([PyTorch](https://dev-discuss.pytorch.org/t/cuda-toolkit-version-and-architecture-support-update-maxwell-and-pascal-architecture-support-removed-in-cuda-12-8-and-12-9-builds/3128)). |
| Driver lifetime | Driver 580 is the last branch for Pascal and is supported until about 2028. Stay on CUDA 12.x; CUDA 13 removed Pascal ([Phoronix](https://www.phoronix.com/news/NVIDIA-580-Linux-Driver-Last-HW), [NVIDIA](https://docs.nvidia.com/cuda/cuda-toolkit-release-notes/index.html)). |
| Out of reach | Isaac Sim: minimum RTX 4080 with 16 GB VRAM and 32 GB RAM ([NVIDIA](https://docs.isaacsim.omniverse.nvidia.com/5.1.0/installation/requirements.html)). Unreal-based simulators and many-camera Gazebo scenes are also out. |

To run Chrome on the NVIDIA GPU, launch it with `__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia google-chrome` and confirm the renderer in `chrome://gpu`. For headless Playwright runs, `__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/10_nvidia.json` with `--use-angle=gl-egl` gives ANGLE on the GTX 1050 Ti *(measured)*.

### 4.2 Decision: keep the browser simulator as the world engine

**Do not port to Isaac Sim, Unreal or Gazebo.**

- It already runs at 60 fps here.
- Its realism gaps (§2) are in estimation, identity, network and radar models. Better graphics fix none of them.
- Every fix in §2 is cheap arithmetic that fits the existing deterministic, unit-tested modules.

Gazebo could come back later as an extra software-in-the-loop target. Harmonic pairs with Jazzy on Ubuntu 24.04 and is supported until 2029; Fortress on 22.04 until May 2027 ([Gazebo](https://gazebosim.org/docs/latest/releases/)). None of it is needed now.

### 4.3 Three fidelity tiers

| Tier | Runs for | Cost | What it proves |
| --- | --- | --- | --- |
| **A. Statistical realism** | Every officer, always | ≤ 3 ms per tick, in a worker | That the algorithms (association, fusion, localization, registry) hold up under realistic error, latency and loss |
| **B. Perception in the loop** | The selected officer, at ≤ 10 fps | One CPU core pair plus a small GPU render | That a *real* pose model on rendered stereo images produces what Tier A assumes. It also calibrates Tier A's detector model. |
| **C. Software in the loop** | Optional, headless | ROS 2 on this laptop | That the *real* officer and team software runs unchanged against simulated sensors |

### 4.4 Tier A: the model changes

Each change is deterministic under a seed and ships with tests. Its parameters come from `params/*.json` (§3.8).

| ID | Change | Files | Parameters start from | Test |
| --- | --- | --- | --- | --- |
| A1 | **Remove the identity leak.** Detections become anonymous. A new association step does Mahalanobis gating plus greedy or Hungarian assignment, and tracks get their own ids. Truth ids stay non-enumerable, for scoring only, the way `mmwave.js` already hides `truthId`. | `vision.js`, `tracking.js`, new `association.js` | — | Two people crossing produce the expected ID-switch count. Scoring still works through the hidden truth. |
| A2 | **Back-project through the estimated pose.** Detection and skeleton back-projection use the self-localization estimate. Pose covariance is propagated as σ² += (range·σθ)² + σp². | `vision.js`, `app/page.tsx` wiring | — | Target error grows linearly with injected heading error × range |
| A3 | **Real error dynamics for self-localization.** VIO drift as a random walk that scales with distance and rotation. Landmark re-localization pulls it back, using the existing landmark-quality score. The IMU becomes biased gyro and accelerometer integration. The compass reads a deterministic magnetic-disturbance field with hot spots near walls and floors, and a gate rejects it. | `sensors.js`, new `imu.js`, new `magnetics.js` | Drift about 1–2% of distance *(est.)* until R2 measures it. Compass hot spots of tens of degrees near steel, based on the up-to-180° reports. | Error grows with distance and shrinks at landmark-rich walls. A compass hot spot fools the gate less than 5% of the time. |
| A4 | **Detector realism.** Detection probability as a function of pixel height and occluded fraction. Person–person occlusion by ray-casting against other capsules. Poisson false positives, seeded partly from landmarks (a poster can look like a person). Officers become detectable, with blue-force suppression against their *estimated* poses. | `vision.js`, `simulation.js`, new `blueforce.js` | Tier B measurements | False-positive rate matches the parameter. A teammate is never flagged when localization is good, and is sometimes confused when it is bad. |
| A5 | **Pose realism.** Per-joint pixel noise scaled by the inverse of body pixel height, occasional left/right swaps, and missing joints. Depth error stays common-mode. | `vision.js` (`cameraSkeleton`) | Tier B measurements | Pose confidence falls with range, and swap rate matches the parameter |
| A6 | **Head motion.** Pitch, roll and walking bob; a turn-rate limit; a blur penalty on detection above a given angular rate. | `simulation.js`, `vision.js` (`officerPose`) | — | A fast turn drops detections for the configured window |
| A7 | **Network and clocks.** Every cross-officer message goes through a `TeamBus`: per-link base latency, per-hop latency, jitter, loss that grows with walls crossed, a bandwidth cap, partitions. Each officer has a clock offset and drift, plus a simple sync. Overlays and the minimap show data age. | new `network.js`, new `clock.js`; consumers in `vision.js`, `overlay.js`, `classification.js` | Wi-Fi guesses until R3 measures it | A skeleton arrives exactly one link-latency late. A partition stops sharing, and the overlay fades by its existing hold and fade rules. |
| A8 | **Honest fusion.** Relayed teammate tracks fuse by covariance intersection. The telemetry panel shows a consistency metric (NEES) so over-confidence becomes visible. | `tracking.js`, new `metrics.js` | — | NEES stays in its χ² band across 20 seeds |
| A9 | **Radar realism.** ~76° × 19° FOV per board, with several boards per puck. ~12 m default range. **Two-way**, wall loss starting near 1.2 dB one way per drywall sheet at normal incidence (28 GHz proxy for 24 GHz), pending R5's measurement of a real stud wall and its angle dependence. A point cloud of several points per body. Multipath ghosts mirrored across nearby walls. Puck yaw from the IMU with an error term, instead of the truth. | `mmwave.js`, `vision.js` (`radarFrame`) | Infineon and arXiv figures in §2, until R5 | Reach through one and two walls matches the budget. The tracker holds one track per body with ghosts present. |
| A10 | **Lighting.** Illuminance per room. In the dark, passive stereo is limited to the IR projector's range, and VIO drift grows. | `simulation.js`, `vision.js`, `sensors.js` | IR range 3–5 m *(est.)* | A dark room shortens detection range as configured |
| A11 | **Scenarios.** Floor plans loaded from JSON (rooms, doors, furniture, corridors), crowds of bystanders, scripted behaviours; later, stairs and multiple floors. | `simulation.js` (`createWorld(plan)`), new `scenarios/*.json` | — | Every scenario loads, and the existing tests still pass on the default plan |
| A12 | **Evaluation harness.** A headless Node runner with no rendering that runs N seeds per scenario and reports GOSPA or IDF1, localization RMSE, overlay registration error, data age and clearance errors. Ten officers for one simulated minute is 3,600 ticks, about 2 s of CPU *(from the measured 0.49 ms)*, so 100 seeds is cheap enough for CI. | new `scripts/run-trials.mjs`, `metrics.js` | — | CI publishes a metrics table. A regression fails the build. |

### 4.5 Tier B: a real pose model in the loop

```text
three.js scene ──(selected officer, 10 fps)──► offscreen left+right render, 640×400, on the NVIDIA GPU
        │                                            │ async readback (WebGL2 PBO + fence), latest frame wins
        │                                            ▼
        │                                   WebSocket to a local Python sidecar
        │                                     • rtmlib RTMPose (OpenVINO CPU, 66 ms measured)
        │                                     • depth: stereo matching (OpenCV SGBM) or the
        │                                       render depth buffer + the stereo noise model
        │                                            │
        ◄─────────── Skeleton18 + PersonArray3D (the §3.5 contract) ──┘
```

- Frames are dropped, never queued. That keeps the render loop at 60 fps even when the model is slow.
- The analytic model runs for the same officer at the same time, and the harness compares the two. The measured miss rate, keypoint noise and swap rate become the A4/A5 parameters.
- **Domain gap.** The simulated people are low-poly capsule figures, so a pose model may do better or worse on them than on real people. Rigged human meshes with a permissive licence would narrow the gap. Treat Tier B as "does the pipeline work", and use R1 measurements for "how accurate is it".
- **Resources.** Pin the sidecar to 2 cores and give the browser the rest. The sidecar needs roughly 0.3–0.5 GB of RAM *(est.)*, so close Firefox and Eclipse while running Tier B. Keep its virtualenv on `/` (23 GB free), not `/home`.

### 4.6 Tier C: software in the loop

- The simulator publishes the §3.5 topics. The real team-fusion, registry, ATAK bridge and AR renderer then run unchanged against it.
- The bridge can be `rosbridge_suite` or `foxglove_bridge` over WebSocket from the page, or a small Node process using `rclnodejs`.
- Record and replay both ways with rosbag2's MCAP storage:
  - real trials (R1–R6) replay into the simulator's visualizer
  - simulator runs replay into the real nodes
- Install ROS 2 Humble natively under `/opt` (on `/`). Avoid multi-gigabyte Docker images, because `/home` is nearly full.

### 4.7 Staying lag-free

| Budget | Today *(measured)* | Target |
| --- | --- | --- |
| Simulator step per tick (all of Tier A) | 0.49 ms mean, 1.19 ms p99 | ≤ 3 ms mean, ≤ 5 ms p99 |
| Render | 59 fps (vsync-capped) on either GPU | ≥ 55 fps; p95 frame ≤ 20 ms |
| Tier B render per stereo exposure | — | ≤ 4 ms at 10 fps *(est.; measure in S8)* |
| Tier B inference | 66 ms (OpenVINO CPU) | Frames dropped, never queued |

How to hold those budgets:

1. **Move the world step and the pipelines into a Web Worker** on a fixed 60 Hz simulated clock. The render thread only reads the latest snapshot, sent as a transferable or through a `SharedArrayBuffer`. `SharedArrayBuffer` needs the COOP and COEP headers.
2. **Add a performance test** (`npm run bench`) that fails CI if the p99 step time exceeds budget. The existing scratch benchmark is the template: 10 officers, 4 pucks, 3,600 ticks.
3. React panels stay throttled, as they already are.
4. Nothing in Tier A allocates per tick in hot loops.

### 4.8 Simulator phases

Run these in order. Each phase lands as its own PR with tests and updated docs.

The file scopes are disjoint, so phases in the same row can be split across parallel implementers after the shared pieces land first: the contract types, the params loader and the TeamBus interface.

| Phase | Contents | Exit criterion |
| --- | --- | --- |
| **S0** Harness | A12 runner and metrics, `params/` loader with provenance, `npm run bench` | Baseline metrics table for the current simulator committed |
| **S1** Truth leaks | A1 identity and A2 estimated-pose back-projection | No module outside scoring reads a truth id or a true pose. A test enforces it. |
| **S2** Localization | A3 VIO, IMU and magnetics; A6 head motion | Minimap blips drift realistically. The error panel shows metres, not centimetres. |
| **S3** Network | A7 TeamBus and clocks; A8 honest fusion | A data-age HUD. Partitions behave. NEES stays in its band. |
| **S4** Perception | A4 detector and blue-force; A5 pose noise | False positives exist and clearing them is a real task |
| **S5** Radar | A9 | Radar reach matches the two-way budget; ghosts are handled |
| **S6** Performance | Worker split | Budgets in §4.7 met with S1–S5 enabled |
| **S7** World | A10 lighting; A11 scenarios | At least 3 floor plans, including one dark building |
| **S8** Tier B | Offscreen stereo, sidecar, comparison report | A real pose model drives one officer at 10 fps with no render lag |
| **S9** Tier C | Contract bridge, MCAP record and replay | A recorded simulator run replays into ROS 2 nodes on this laptop |

---

## 5. Legal, ethical and safety constraints

- **Through-wall sensing is a search in many jurisdictions.**
  - In the US, *Kyllo v. United States* (2001) held that thermal imaging of a home from the street is a search that needs a warrant.
  - Police use of the Range-R through-wall radar drew scrutiny in 2015, and *United States v. Denson* (10th Cir. 2014) discussed it ([Justia](https://law.justia.com/cases/federal/appellate-courts/ca10/13-3329/13-3329-2014-12-30.html), [Range-R](https://en.wikipedia.org/wiki/Range-R)).
  - Get counsel to confirm the rules wherever you will deploy. In India, for example, that means privacy as a fundamental right (*Puttaswamy*, 2017) and the DPDP Act 2023 *(confirm with counsel)*.
- **No identity recognition.** The EU AI Act has prohibited real-time remote biometric identification in public spaces for law enforcement since 2 February 2025, with narrow exceptions that need prior authorisation ([FPF](https://fpf.org/blog/red-lines-under-the-eu-ai-act-restricting-real-time-remote-biometric-identification-systems-for-law-enforcement-purposes/)). The design already avoids identity; keep it that way.
- **Radio licensing.** The 24 GHz ISM band and UWB are licensed differently in each country. Check with the national regulator (for example, WPC in India or the FCC in the US) before any field use, and confirm the exact permitted bandwidth around 24 GHz for radar rather than general ISM use *(unverified; confirm per country)*.
- **Automation bias.** The simulator flags every person by default and calls the clear action **Not a terrorist**. On a real officer's display that framing can push toward force against bystanders. Show "person detected" with a neutral colour. Present uncertainty rings and data age prominently. Never automate intent. Keep the human clearance and the audit log.
- **Friendly fire.** Teammates are drawn at *estimated* poses. The blue-force marker must look unmistakably different from a detected person, and must show its own uncertainty.
- **Failure behaviour.** When data goes stale or the network drops, overlays must fade and say so, not freeze in place. The existing hold, fade and lapse rules are the right pattern; extend them to network loss.

## 6. Risks and open questions

| Risk | Mitigation |
| --- | --- |
| Indoor shared-frame localization is not good enough to draw people behind walls | Entry anchors, UWB constraints and map merging. Show uncertainty honestly. Fall back to the 2D minimap when the AR registration budget is exceeded. |
| Radar at 24 GHz still does not get through the walls you care about (brick, concrete, metal studs) | Measure in R5 first. 24 GHz should penetrate drywall better than the 60 GHz alternative (§2, item 13), but metal studs and brick are untested at this frequency. |
| The pose model is unreliable on small, distant or partly hidden people | Show only the centroid below a pixel-height threshold. Draw skeletons only where confidence is high. |
| This laptop's RAM (7.6 GB) | Tier A needs almost nothing. Run Tier B and Tier C one at a time, with other applications closed. |

**Questions only you can answer:**

1. Which country will this be tested in? That decides the legal and radio review.
2. What is the budget per officer kit, and for the first two kits?
3. Is an optical see-through display required, or is a wrist or handheld display acceptable at first?
4. Is there a training building available for trials R5 and R6?
5. Does commercial licensing matter? RTMPose is Apache-2.0; YOLO26 is AGPL-3.0 or paid.

## Sources

All sources were checked on 22 September 2026.

- Luxonis OAK-D Pro W specifications: https://docs.luxonis.com/hardware/products/OAK-D%20Pro%20W
- Luxonis depth accuracy: https://docs.luxonis.com/hardware/platform/depth/depth-accuracy
- Luxonis RVC4: https://docs.luxonis.com/hardware/platform/rvc/rvc4
- DepthAI v3 VIO and SLAM nodes: https://docs.luxonis.com/software-v3/depthai/release-notes
- RealSense spin-out from Intel: https://www.intelcapital.com/realsense-completes-spin-out-from-intel-raises-50-million-to-accelerate-ai-powered-vision-for-robotics-and-biometrics/
- Jetson Orin Nano Super: https://developer.nvidia.com/blog/nvidia-jetson-orin-nano-developer-kit-gets-a-super-boost/
- cuVSLAM paper: https://arxiv.org/html/2506.04359v2
- Isaac ROS Visual SLAM: https://github.com/NVIDIA-ISAAC-ROS/isaac_ros_visual_slam
- rtmlib: https://github.com/Tau-J/rtmlib
- RTMO paper: https://arxiv.org/html/2312.07526v1
- Ultralytics YOLO26: https://docs.ultralytics.com/models/yolo26
- Magnetometer error near ferromagnetic material (citing Bachmann 2004): https://pmc.ncbi.nlm.nih.gov/articles/PMC9605636/
- ZUPT dead-reckoning accuracy: https://bpb-us-e2.wpmucdn.com/faculty.sites.uci.edu/dist/e/700/files/2020/11/GNSS20-0148.pdf
- UWB line-of-sight and obstructed ranging error: https://pmc.ncbi.nlm.nih.gov/articles/PMC9657962/
- Infineon BGT24MTR12 / Position2Go application note: https://community.infineon.com/gfawx74859/attachments/gfawx74859/XMC/11081/1/Infineon-AN553_BGT24MTR12_XMC4700_Position2Go_DemoBoard-ApplicationNotes-v01_03-EN.pdf
- 60 GHz penetration loss (NIST, kept for comparison against the 24 GHz choice): https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=929131
- Building-material attenuation at 28, 73 and 91 GHz, used as the closest measured proxy for 24 GHz drywall loss: https://arxiv.org/pdf/2004.12568
- mmWave ghost suppression: https://pmc.ncbi.nlm.nih.gov/articles/PMC12158235/
- Covariance intersection: https://www.researchgate.net/publication/379474850_A_Quarter_Century_of_Covariance_Intersection_Correlations_Still_Unknown_Lecture_Notes
- Chrony with hardware timestamping: https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/10/html/configuring_time_synchronization/chrony-with-hw-timestamping
- rmw_zenoh: https://github.com/ros2/rmw_zenoh
- ROS 2 end-of-life dates: https://docs.ros.org/en/humble/Releases/End-of-Life.html
- Gazebo releases: https://gazebosim.org/docs/latest/releases/
- Isaac Sim requirements: https://docs.isaacsim.omniverse.nvidia.com/5.1.0/installation/requirements.html
- TensorRT support matrix: https://docs.nvidia.com/deeplearning/tensorrt/latest/getting-started/support-matrix.html
- PyTorch drops Pascal from cu128+ builds: https://dev-discuss.pytorch.org/t/cuda-toolkit-version-and-architecture-support-update-maxwell-and-pascal-architecture-support-removed-in-cuda-12-8-and-12-9-builds/3128
- Driver 580 is the last for Pascal: https://www.phoronix.com/news/NVIDIA-580-Linux-Driver-Last-HW
- CUDA release notes: https://docs.nvidia.com/cuda/cuda-toolkit-release-notes/index.html
- XREAL One Pro: https://www.xreal.com/us/one-pro
- HoloLens 2 discontinued: https://www.uploadvr.com/microsoft-discontinuing-hololens-2/
- Mesh radio integration guide: https://uas-forge.com/mesh-guide/
- ATAK: https://en.wikipedia.org/wiki/Android_Team_Awareness_Kit
- Open-source TAK ecosystem: https://corvusintell.com/blog/field-apps/open-source-tak-ecosystem-guide/
- COVINS-G: https://arxiv.org/pdf/2301.07147
- Bounce Imaging Explorer: https://bounceimaging.com/products/explorer-2-0-tactical-audio-edition/
- Motion-to-photon latency: https://vrarwiki.com/wiki/Motion-to-photon_latency
- United States v. Denson: https://law.justia.com/cases/federal/appellate-courts/ca10/13-3329/13-3329-2014-12-30.html
- Range-R: https://en.wikipedia.org/wiki/Range-R
- EU AI Act real-time biometric identification: https://fpf.org/blog/red-lines-under-the-eu-ai-act-restricting-real-time-remote-biometric-identification-systems-for-law-enforcement-purposes/
