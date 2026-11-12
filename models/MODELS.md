# SOBO: organ models by grade level

Converted from your Z-Anatomy exports. Every body system comes in three levels that match the app's grade levels:

| Level | Grades | What's in it |
|---|---|---|
| `simple` | 4 | A few big, kid-friendly organs (e.g. *Heart*, *Arteries*, *Veins*) |
| `medium` | 5–6 | Organs split up more (e.g. *Aorta*, *Vena cava*, *Pulmonary arteries*...) |
| `full` | 7 | Most detail (e.g. separate heart chambers, valves, coronary arteries) |

## Files

- `models/<system>-<level>.glb`: 22 files (reproductive is Full only)
- `manifest.json`: every organ per file: slug, label, colour, centre position, size, triangle count, and the Z-Anatomy parts it contains
- `organ_models_seed.sql`: a Supabase table + seed rows for all organs (run it in the SQL editor)
- `previews/`: front-view renders of each system at all three levels

## How the GLBs are built

- **One node per organ.** The node `name` is the organ slug (e.g. `small-intestine`). Click it, highlight it, hide it or drag it on its own.
- **`node.position` = the organ's real place in the body.** Each mesh is centred on its own origin, so in System Builder the correct drop target is just the original `node.position`. Save it before you scramble the organs.
- **`node.userData`** (from glTF extras) holds `label`, `system`, `level`, `parts` (the Z-Anatomy structures merged into it) and `sides` (left/right).
- **All systems share one coordinate space** (metres, +Y up, +Z = front of the body, about 1.7 m tall), so loading several systems together lines them up automatically.
- Plain glTF 2.0 with no extensions and no textures. Each organ has a simple coloured material that you can override in code.
- Paired organs (kidneys, lungs at lower levels, eyes, muscles) are one organ containing both sides. The `sides` field says so.

## Loading in plain JavaScript (three.js)

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const gltf = await loader.loadAsync(`models/${system}-${level}.glb`); // e.g. 'digestive-simple'
const root = gltf.scene;
scene.add(root);

// every organ is a direct child of the system's root node
const organs = {};
root.children[0].children.forEach(node => {
  organs[node.name] = node;                       // node.name === slug
  node.userData.home = node.position.clone();     // correct spot (System Builder)
});

// raycast hit -> organ
function organFromHit(obj) {
  while (obj && !(obj.userData && obj.userData.label)) obj = obj.parent;
  return obj; // obj.name = slug, obj.userData.label = display name
}
```

## Organs per level

### Skeletal

| Level | File | Organs | Triangles | Size |
|---|---|---|---|---|
| simple | `skeletal-simple.glb` | skull, backbone, ribcage, collarbone, shoulder-blade, upper-arm-bone, forearm-bones, hand-bones, hip-bones, thigh-bone, kneecap, lower-leg-bones, foot-bones | 61,071 | 1.1 MB |
| medium | `skeletal-medium.glb` | skull, jaw, teeth, hyoid, cervical-vertebrae, thoracic-vertebrae, lumbar-vertebrae, sacrum-coccyx, ribs, sternum, clavicle, scapula, humerus, radius, ulna, carpals, metacarpals, finger-bones, pelvis, femur, patella, tibia, fibula, tarsals, metatarsals, toe-bones | 150,526 | 2.7 MB |
| full | `skeletal-full.glb` | frontal-bone, parietal-bones, temporal-bones, occipital-bone, sphenoid-bone, ethmoid-bone, maxilla, zygomatic-bones, nasal-bones, other-facial-bones, costal-cartilages, ribs, jaw, teeth, hyoid, cervical-vertebrae, thoracic-vertebrae, lumbar-vertebrae, sacrum-coccyx, sternum, clavicle, scapula, humerus, radius, ulna, carpals, metacarpals, finger-bones, pelvis, femur, patella, tibia, fibula, tarsals, metatarsals, toe-bones | 290,291 | 5.2 MB |

### Muscular

| Level | File | Organs | Triangles | Size |
|---|---|---|---|---|
| simple | `muscular-simple.glb` | chest-muscle, deltoid, biceps, triceps, abdominal-muscles, trapezius, latissimus-dorsi, gluteus-maximus, quadriceps, hamstrings, calf-muscles, shin-muscle, neck-muscle, jaw-muscles, diaphragm | 78,566 | 1.3 MB |
| medium | `muscular-medium.glb` | chest-muscle, deltoid, biceps, triceps, brachialis, forearm-flexors, forearm-extensors, abs, obliques, intercostals, serratus-anterior, trapezius, latissimus-dorsi, rotator-cuff, back-muscles, gluteus-maximus, gluteus-medius, hip-flexors, quadriceps, hamstrings, adductors, sartorius, calf-muscles, shin-muscles, achilles-tendon, neck-muscle, jaw-muscles, face-muscles, diaphragm | 217,809 | 3.6 MB |
| full | `muscular-full.glb` | chest-muscle, deltoid, biceps, triceps, brachialis, forearm-flexors, forearm-extensors, abs, obliques, intercostals, serratus-anterior, trapezius, latissimus-dorsi, rotator-cuff, back-muscles, gluteus-maximus, gluteus-medius, hip-flexors, quadriceps, hamstrings, adductors, sartorius, calf-muscles, shin-muscles, achilles-tendon, neck-muscle, jaw-muscles, face-muscles, diaphragm, other-head-muscles, other-neck-muscles, hand-muscles, foot-muscles, other-leg-muscles, other-trunk-muscles | 373,983 | 6.2 MB |

### Nervous

| Level | File | Organs | Triangles | Size |
|---|---|---|---|---|
| simple | `nervous-simple.glb` | brain, spinal-cord, nerves, eyes, ears, ear-ossicles | 127,074 | 2.2 MB |
| medium | `nervous-medium.glb` | cerebrum, cerebellum, brainstem, spinal-cord, cranial-nerves, nerves, eyes, ears, ear-ossicles | 211,194 | 3.6 MB |
| full | `nervous-full.glb` | cerebrum, cerebellum, brainstem, thalamus, hypothalamus, corpus-callosum, basal-ganglia, hippocampus, spinal-cord, optic-nerves, cranial-nerves, sympathetic-trunk, nerves, eyeball, iris, lens, retina, tear-glands, eardrum, ear-ossicles, cochlea, vestibule, auditory-tube | 386,807 | 7.6 MB |

### Circulatory

| Level | File | Organs | Triangles | Size |
|---|---|---|---|---|
| simple | `circulatory-simple.glb` | heart, arteries, veins | 61,901 | 1.1 MB |
| medium | `circulatory-medium.glb` | heart, aorta, vena-cava, pulmonary-arteries, pulmonary-veins, carotid-arteries, jugular-veins, arteries, veins | 98,553 | 1.8 MB |
| full | `circulatory-full.glb` | right-atrium, right-ventricle, left-atrium, left-ventricle, heart-valves, coronary-arteries, cardiac-veins, aorta, vena-cava, pulmonary-arteries, pulmonary-veins, carotid-arteries, jugular-veins, hepatic-portal-vein, arteries, veins | 367,620 | 6.7 MB |

### Respiratory

| Level | File | Organs | Triangles | Size |
|---|---|---|---|---|
| simple | `respiratory-simple.glb` | lungs, trachea, diaphragm | 12,103 | 0.2 MB |
| medium | `respiratory-medium.glb` | right-lung, left-lung, larynx, trachea, bronchi, diaphragm | 44,081 | 0.8 MB |
| full | `respiratory-full.glb` | right-upper-lobe, right-middle-lobe, right-lower-lobe, left-upper-lobe, left-lower-lobe, larynx, trachea, main-bronchi, lobar-bronchi, segmental-bronchi, diaphragm | 86,648 | 1.6 MB |

### Digestive

| Level | File | Organs | Triangles | Size |
|---|---|---|---|---|
| simple | `digestive-simple.glb` | mouth, oesophagus, stomach, liver, pancreas, small-intestine, large-intestine | 34,711 | 0.6 MB |
| medium | `digestive-medium.glb` | mouth, salivary-glands, pharynx, oesophagus, stomach, liver, gallbladder, pancreas, small-intestine, large-intestine, appendix | 68,198 | 1.2 MB |
| full | `digestive-full.glb` | tongue, gums, palate, salivary-glands, pharynx, oesophagus, stomach, liver, gallbladder, bile-duct, pancreas, duodenum, jejunum-ileum, ascending-colon, transverse-colon, descending-colon, sigmoid-colon, appendix | 116,777 | 2.1 MB |

### Urinary

| Level | File | Organs | Triangles | Size |
|---|---|---|---|---|
| simple | `urinary-simple.glb` | kidneys, ureters, bladder, urethra | 4,168 | 0.1 MB |
| medium | `urinary-medium.glb` | kidneys, renal-pelvis, ureters, bladder, urethra | 7,549 | 0.1 MB |
| full | `urinary-full.glb` | kidneys, renal-pelvis, ureters, bladder, urethra, renal-arteries, renal-veins | 57,741 | 1.1 MB |

### Reproductive

| Level | File | Organs | Triangles | Size |
|---|---|---|---|---|
| full | `reproductive-full.glb` | testes, epididymis, sperm-ducts, seminal-glands, prostate, penis | 11,020 | 0.2 MB |

## Notes

- **Not in your files, so not in the models:** rectum/anus, nose and nasal cavity, adrenal glands, and the female reproductive system (the Reproductive file is male only).
- **Reproductive** is only made at Full level (grade 7). Whether to show it is up to you and your school.
- **Respiratory** borrows the *diaphragm* from the muscular file and the *larynx* from the skeleton file. **Nervous** borrows the ear bones from the skeleton file. **Urinary (Full)** borrows the renal arteries and veins from the cardiovascular file.
- **Left out as hidden or too small for grades 4–7:** brainstem nuclei and spinal tracts, ventricles, meninges (dura), the inner stomach lining, the colon's surface bands, bursae, ligaments and fascia. At Full level, the tiniest branches of the 'Other arteries / veins / nerves' groups are dropped when a file would get too heavy.
- **Optional extra compression:** these files have no Draco. If you want them smaller, run `npx @gltf-transform/cli draco in.glb out.glb` (then add `DRACOLoader` to the loader).

## Licence (important)

These models are derived from **Z-Anatomy** (https://www.z-anatomy.com), licensed **CC BY-SA 4.0**. They were modified: structures grouped into organs, simplified for each grade level and recoloured. To use them you must:

1. **Credit** Z-Anatomy in the app, e.g. on an About/Credits page: *"3D anatomy models adapted from Z-Anatomy (z-anatomy.com), CC BY-SA 4.0."*
2. **Share the models under the same licence** (CC BY-SA 4.0) if you distribute them. The licence covers the models, not your app's code.
