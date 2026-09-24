"""Mutation check for tests/verify_music.py: plant one fault at a time in a copy of
pipeline/audio/make_music.py, render the music into a scratch content tree with it,
and confirm the verifier goes red. An unmutated copy must pass first.

    python tests/mutation_music.py
"""
import os, shutil, subprocess, sys, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SYNTH = os.path.join(REPO, 'pipeline', 'audio', 'make_music.py')
VERIFY = os.path.join(REPO, 'tests', 'verify_music.py')

MUTANTS = [
    ('sharps are ignored', "{'#': 1, 'b': -1, None: 0}[acc]", "{'#': 0, 'b': -1, None: 0}[acc]"),
    ('every note an octave low', '12 * (int(octave) + 1)', '12 * int(octave)'),
    ('the loop is cut from the first pass', 'loop = mix[loop_n:2 * loop_n]', 'loop = mix[:loop_n]'),
    ('notes start half a beat late', 's = int(round((start + rep * loop_units) * unit * SR))',
     's = int(round((start + 0.5 + rep * loop_units) * unit * SR))'),
    ('written as 16-bit', 'w.setsampwidth(1)', 'w.setsampwidth(2)'),
]

src = open(SYNTH, encoding='utf-8').read()
tmp = tempfile.mkdtemp(prefix='crowmere-music-mut-')
os.makedirs(os.path.join(tmp, 'src'))
os.makedirs(os.path.join(tmp, 'content'))
shutil.copy(os.path.join(REPO, 'content', 'game.json'), os.path.join(tmp, 'content', 'game.json'))
env = dict(os.environ, CROWMERE_ROOT=tmp, CROWMERE_MUSIC_SRC=os.path.join(tmp, 'src'))


def attempt(code):
    path = os.path.join(tmp, 'src', 'make_music.py')
    open(path, 'w', encoding='utf-8', newline='\n').write(code)
    shutil.rmtree(os.path.join(tmp, 'content', 'music'), ignore_errors=True)
    subprocess.run([sys.executable, path], env=env, capture_output=True, text=True, check=True)
    return subprocess.run([sys.executable, VERIFY], env=env, capture_output=True, text=True)


base = attempt(src)
if base.returncode != 0:
    print('the unmutated synth fails verification; fix that before trusting any result\n' + base.stdout[-2000:])
    sys.exit(2)

survivors = 0
for name, find, rep in MUTANTS:
    if src.count(find) != 1:
        raise SystemExit(f'mutant "{name}": find text occurs {src.count(find)} times, expected 1')
    caught = attempt(src.replace(find, rep)).returncode != 0
    survivors += not caught
    print(f"{'caught  ' if caught else 'SURVIVED'}  {name}")
print(f'{len(MUTANTS) - survivors}/{len(MUTANTS)} mutants caught')
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(1 if survivors else 0)
