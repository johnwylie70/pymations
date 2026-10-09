# A real Manim Community script, unchanged. Run it:   pymations run polyhedron.py
# Share it:   pymations build polyhedron.py -o polyhedron.html

from manim import *

# 3D: an icosahedron turning about two axes under a fixed-in-frame title, then a camera move.


class RotatingPolyhedron(ThreeDScene):
    def construct(self):
        self.set_camera_orientation(phi=65 * DEGREES, theta=-40 * DEGREES)
        title = Text("Icosahedron", font_size=40).to_edge(UP)
        caption = Text("20 faces, 12 vertices, 30 edges", font_size=26).to_edge(DOWN)
        self.add_fixed_in_frame_mobjects(title, caption)
        self.remove(title, caption)

        solid = Icosahedron(edge_length=2)
        solid.set_fill(TEAL, opacity=0.6).set_stroke(WHITE, width=2)

        self.play(Write(title))
        self.play(Create(solid), run_time=2)
        self.play(Rotate(solid, TAU, axis=OUT), run_time=4, rate_func=linear)
        self.play(FadeIn(caption, shift=UP * 0.3))
        self.play(Rotate(solid, PI, axis=RIGHT), run_time=2)
        self.move_camera(phi=80 * DEGREES, theta=20 * DEGREES, run_time=2)
        self.wait()
