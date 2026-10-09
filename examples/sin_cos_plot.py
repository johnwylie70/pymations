# A real Manim Community script, unchanged. Run it:   pymations run sin_cos_plot.py
# Share it:   pymations build sin_cos_plot.py -o sin_cos_plot.html

from manim import *

# Gallery-style: sine and cosine on one pair of axes, each with a label, and a marker at x = 2*pi.


class SinAndCosPlot(Scene):
    def construct(self):
        axes = Axes(
            x_range=[-10, 10.3, 1],
            y_range=[-1.5, 1.5, 1],
            x_length=10,
            axis_config={"color": GREEN},
            tips=False,
        )
        sin_graph = axes.plot(lambda x: np.sin(x), color=BLUE)
        cos_graph = axes.plot(lambda x: np.cos(x), color=RED)

        sin_label = MathTex(r"\sin(x)", color=BLUE).next_to(axes.c2p(-10, 1), UR)
        cos_label = MathTex(r"\cos(x)", color=RED).next_to(axes.c2p(10, 1), UL)

        marker = DashedLine(axes.c2p(TAU, -1.2), axes.c2p(TAU, 1.2), color=YELLOW)
        marker_label = MathTex(r"x = 2\pi", color=YELLOW, font_size=36).next_to(marker, DOWN, buff=0.1)

        self.play(Create(axes), run_time=1.5)
        self.play(Create(sin_graph), Write(sin_label), run_time=2)
        self.play(Create(cos_graph), Write(cos_label), run_time=2)
        self.play(Create(marker), FadeIn(marker_label, shift=DOWN * 0.3))
        self.wait()
