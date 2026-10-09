# A real Manim Community script, unchanged. Run it:   pymations run surface_orbit.py
# Share it:   pymations build surface_orbit.py -o surface_orbit.html

from manim import *

# 3D: a checkerboard surface on ThreeDAxes while the camera orbits (ambient rotation), with a flat HUD title.


class SurfaceOrbit(ThreeDScene):
    def construct(self):
        axes = ThreeDAxes(x_range=[-3, 3, 1], y_range=[-3, 3, 1], z_range=[-1.5, 1.5, 0.5], x_length=6, y_length=6, z_length=3)
        surface = Surface(
            lambda u, v: axes.c2p(u, v, np.sin(u) * np.cos(v)),
            u_range=[-3, 3],
            v_range=[-3, 3],
            resolution=(24, 24),
            checkerboard_colors=[BLUE_D, BLUE_E],
            fill_opacity=0.9,
        )
        title = Text("z = sin(x) cos(y)", font_size=36).to_corner(UL)
        self.set_camera_orientation(phi=70 * DEGREES, theta=-45 * DEGREES)
        self.add_fixed_in_frame_mobjects(title)

        self.play(Write(title))
        self.play(Create(axes), run_time=1.5)
        self.play(FadeIn(surface), run_time=1.5)
        self.begin_ambient_camera_rotation(rate=0.4)
        self.wait(5)
        self.stop_ambient_camera_rotation()
        self.move_camera(phi=45 * DEGREES, zoom=1.2, run_time=2)
        self.wait()
