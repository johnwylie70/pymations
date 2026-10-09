# The Camera

The camera frame is the part of the scene you see. Move it, scale it or animate it to pan and zoom.

```python
from manim import *

class Zoom(MovingCameraScene):
    def construct(self):
        grid = NumberPlane()
        dot = Dot([3, 2, 0], color=YELLOW)
        self.add(grid, dot)
        self.camera.frame.save_state()
        self.play(self.camera.frame.animate.scale(0.4).move_to(dot))
        self.wait()
        self.play(Restore(self.camera.frame))
```

- `self.camera.frame` (or `camera.frame` in the bare form) can be moved, scaled and played like any other thing: `shift`, `move_to`, `scale`, `set(width=…)`.
- Scaling the frame by 0.5 zooms in two times.
- `self.camera.frame.save_state()` and `Restore(self.camera.frame)` return to where it was.
- Line widths and text stay in scene units, so zooming in makes them bigger, the same as Manim's.

In the bare form:

```python
from pymations import *

dots = VGroup(*[Dot([x, y, 0]) for x in range(-6, 7, 2) for y in range(-3, 4, 2)])
add(dots)
camera.frame.save_state()
play(camera.frame.animate.scale(0.5).move_to(dots[0]))
play(Restore(camera.frame))
```

`MovingCameraScene` and `ZoomedScene` both work this way. A plain `Scene` has the same frame.

## 3D

`ThreeDScene`, `ThreeDAxes`, `set_camera_orientation` and `move_camera` are accepted, so a 3D script runs, but it plays flat, seen from the front, and says so once. `add_fixed_in_frame_mobjects` adds things as usual.
