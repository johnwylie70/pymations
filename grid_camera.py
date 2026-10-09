# A real Manim Community script, unchanged. Run it:   pymations run grid_camera.py
# Share it:   pymations build grid_camera.py -o grid_camera.html

from manim import *

# Gallery-style: a grid of squares fades in with LaggedStart; the camera frame zooms to one cell and back.


class GridAndCamera(MovingCameraScene):
    def construct(self):
        cells = VGroup(*[Square(side_length=0.8) for _ in range(24)])
        cells.arrange_in_grid(rows=4, buff=0.15)
        cells.set_stroke(BLUE, width=3)

        self.play(LaggedStart(*[FadeIn(c, scale=0.5) for c in cells], lag_ratio=0.08), run_time=2)

        target = cells[9]
        self.play(target.animate.set_fill(YELLOW, opacity=0.8))
        self.play(self.camera.frame.animate.scale(0.35).move_to(target), run_time=2)
        label = MathTex("(2, 4)", font_size=24).next_to(target, UP, buff=0.1)
        self.play(Write(label))
        self.wait(0.5)
        self.play(self.camera.frame.animate.scale(1 / 0.35).move_to(ORIGIN), run_time=2)
        self.play(LaggedStart(*[c.animate.set_fill(TEAL, opacity=0.6) for c in cells], lag_ratio=0.05))
        self.wait()
