# Sound

Sounds play in step with the timeline: pausing silences them, and dragging the scrubber starts them from that moment.

```python
from pymations import *

music("music.mp3", volume=0.3)
section("Intro", sound="intro.mp3")
play(Write(Text("Hello")))
add_sound("click.wav")
play(Create(Circle()))
wait_for_sound()
```

| Call | What it does |
|---|---|
| `add_sound("file.mp3", time_offset=0, gain=None)` | Play a sound from this point of the timeline. `gain` is in decibels, the same as Manim's (`-6` is quieter) |
| `music("file.mp3", volume=0.3, fade_in=0, fade_out=1, loop=True)` | Music under the whole timeline from here, quiet and looping |
| `wait_for_sound(sound=None, extra=0)` | Wait until a sound (or the last one started) has finished |
| `section("name", sound="voice.mp3")` | Start a section with a voice-over; the section lasts at least as long as it |

In a scene, `self.add_sound(...)` works too.

Sound files are read beside your scene, by a relative path. `pymations build` includes the ones named in your code: copied into the folder, or packed into the one file. A browser plays sound only after the page has been clicked or tapped once; until then the animation plays silently.

MP3, WAV, OGG, M4A, AAC and FLAC files work, as far as the browser plays them.
