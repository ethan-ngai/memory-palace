/**
 * @file manual-test.ts
 * @description Manual Node-side script for testing concept extraction with pasted text input.
 * @module concept-extraction
 */
import { extractConceptsFromSource } from "./server/concept-extraction.server";
import type { Concept, ExtractionInput } from "./types";

function printSummary(concepts: Concept[]) {
  console.log("Total concepts:", concepts.length);
  console.log("First 3:", concepts.slice(0, 3));
}

async function main() {
  // These scripts run on the server in Node, not in the browser.
  // Text input goes straight to extraction with no scraping step.
  // Because this script runs outside the TanStack app runtime, it calls the
  // server implementation directly instead of the createServerFn wrapper.

  // ===== REPLACE THIS WITH YOUR INPUT =====
  const studyText = `
    Over the next two lectures, we will think about counting functions with different properties.
    To do this, we’ll use a popular framing in combinatorics of functions as arrangements of balls
    in bins. We’ll view the domain elements as a set of balls and the codomain elements as a set of
    bins. A function maps each domain element to a unique codomain element, which corresponds
    to placing each ball into one bin.
    Balls and bins problems are perhaps the most important for computer scientists. As we have
    mentioned numerous times, we can view computations as evaluating functions on data inputs.
    Therefore, being able to reason about the possible mappings will be crucial in analyzing
    randomized algorithms and understanding what we can expect from their performance. The
    prototypical example of this is the hashing problem, where items are stored in buckets with
    the hope that not too many items end up in any one bucket. You’ll discuss hashing in greater
    detail in a data structures course. However, this balls and bins approach extends beyond just
    hashing. By being clever about what we view as the balls and what we view as the bins, we
    will see that many other problems also fit into this paradigm.
    The Balls and Bins Setup
    Throughout this and the next lecture, we’ll use n to denote the number of balls (i.e., the size of
    the domain set) and m to denote the number of bins (i.e., the size of the codomain set). We
    will also consider two different types of balls and two different types of bins.
    Distinguishable vs. Indistinguishable Balls:
    In a setting with distinguishable balls, we imagine that each of the balls has a different color
    (we will also label them with different letters in our figures). Therefore, we can identify each
    individual ball by looking at their final arrangement. This contrasts with indistinguishable
    balls, which we imagine are all the same color. In this case, the only thing that distinguishes
    the arrangements is the number of balls that each bin contains. As an example, the two
    arrangements shown on the following page are different when the balls are distinguishable.
    However, they would be the same if the balls were made indistinguishable.
    22.2 Distinguishable Balls and Bins 197
    c
    a
    a b
    b c
    1 2
    1 2
    Distinguishable vs. Indistinguishable Bins:
    In a setting with distinguishable bins, we imagine that each of the bins has been labeled with a
    different number. Therefore, the specific bin that each ball lands in makes a difference. This
    contrasts with indistinguishable bins, which we imagine are unlabeled and identical. In this
    case, the only thing that distinguishes the arrangements is how the balls are divided, and not
    the bin where each of the divisions is placed. As an example, the two arrangements shown
    below are different when the bins are distinguishable. However, they would be the same if the
    bins were made indistinguishable.
    c
    c
    a b
    a
    b
    1 2
    1 2
    We will separately consider different combinations of these types of balls and bins, focusing on
    the cases of distinguishable balls and bins, indistinguishable balls with distinguishable bins, and
    (next lecture) distinguishable balls with indistinguishable bins. The case of indistinguishable
    balls and bins is more difficult and will not be considered in this course. In each of these
    settings, we wish to identify a formula for the number of functions (in general), the number of
    injective functions, and the number of surjective functions. By the end of the next lecture, we
    will be able to fill the following chart with these formulas.
    22.2 Distinguishable Balls and Bins
    As a warm-up, we’ll consider the case of distinguishable balls and distinguishable bins. In
    this setting, each of the n balls has a different color {red, gray,. . .}, and each of the m bins is
    labeled with a number from [m]. If you are asked to place each ball in a bin and then take a
    picture at the end, how many different pictures are possible?
    In this case, we can use the Multiplication Rule, reasoning about one ball at a time. First, we
    choose which of the m bins receives the red ball. Next, we choose which of the m bins receives
    the blue ball. This repeats for all n balls. Thus, the total number of ways is mn
    .
    n Balls m Bins Arrangements Injective
    Arrangements
    Surjective
    Arrangements
    Distinguishable Distinguishable
    Indistinguishable Distinguishable
    Distinguishable Indistinguishable
    22.3 Indistinguishable Balls, Distinguishable Bins 198
    Now, suppose that we place the additional requirement that no bin can contain more than
    one ball. Viewing our arrangement as a function {balls}→{bins}, this requirement imposes
    injectivity. As a first observation, we can note that this is impossible if n > m (by the Pigeonhole
    Principle). Otherwise, we can again use the Multiplication Rule. First, we choose in which of
    the m bins to place the red ball. Next, we choose in which of the m−1 still-empty bins to place
    the blue ball. This repeats for all n balls. Giving us a total of
    m·(m−1)·
    . . .
    ·(m−n + 1) = m!
    (m−n)!
    arrangements. As a convention, many people often generalize the definition of the binomial
    coefficients so that m
    n
    = 0 when n > m. In this case, we can express the number of arrangements
    as m
    n·n!, to capture both of the above cases. This formula lends itself to another combinatorial
    interpretation of this problem. Namely, to select an injective map, we can first choose which n
    of the m bins will receive a ball. Then, we line the bins up and select a permutation over the
    balls to determine which bin gets which ball.
    We could instead require that at least one ball be placed in each bin, which is equivalent to
    requiring that the {balls}→{bins}function is surjective. We will return to the question of
    counting these functions in the next lecture.
    22.3 Indistinguishable Balls, Distinguishable Bins
    Next, we’ll consider the scenario where the balls are indistinguishable (they all have the same
    color), but the bins are distinguishable (labeled with numbers from [m]). How can we count
    these arrangements?
    Finding a counting process is not as immediate in this case. We can’t use the same trick of the
    Multiplication Rule to deal with the balls one at a time. Since the balls look the same, placing
    the first ball in bin 2 and the second ball in bin 5 will result in the same “picture” as if we
    placed the first ball in bin 5 and the second ball in bin 2. Moreover, we cannot use the Division
    Rule to account for these multiple paths to the same outcome, since this isn’t consistent across
    the outcomes. For example, there’s only one decision path that places all of the balls in bin 1.
    However, there are n! different decision paths that place one ball in each bin when n = m. We
    will need a different approach. Amazingly, there is a nice bijective argument (often called the
    stars and stripes argument) that will allow us to count these arrangements. We’ll illustrate this
    bijection with an example.
    Example 22.1 Consider the case of n = 5 balls in m = 4 bins. One possible arrangement is
    1 2 3 4
    We can encode this arrangement with a string of ‘∗’s and ‘|’s, where we interpret the stars as
    representing the balls and the stripes as delineating the bins. In this case, we have the string
    “∗||∗∗∗|∗”.
    22.3 Indistinguishable Balls, Distinguishable Bins 199
    Let’s think more about this map ϕ from the arrangements to these strings. To understand about
    the range of this map, we note that
    • Each string includes exactly n stars, 1 for each ball.
    • Each string includes exactly m−1 stripes, 1 just after each bin except for the last.
    In fact, ϕ describes a bijection between the arrangements and the strings that satisfy these two
    conditions. One could argue that this map is injective and surjective, but the easier way to see
    this is to note that this encoding process is reversible: given any string in this form, we can
    construct the corresponding arrangement by starting at bin 1, dropping a ball whenever we
    see a star, and moving to the next bin whenever we see a bar.
    By the Bijection Rule, the number of arrangements is exactly the number of these strings. To
    generate these strings we can select m−1 of the n + m−1 positions to place stripes and fill the
    remaining positions with stars. Thus, there aren+m−1
    m−1 =
    n+m−1
    n such strings.
    Again, we can ask about injective and surjective maps in this setting. Here, the arrangements
    that result from an injective map will have 1 ball each in n of the m bins. Thus, there arem
    n
    such arrangements; where again we are using the generalized binomial coefficient to ensure
    there are 0 arrangements when n > m.
    For surjective maps, we again use the Bijection Rule. Note that an arrangement resulting from
    a surjective map has at least one ball in each bin. By removing one ball from each bin, we are
    left with an arbitrary arrangement of n−m balls across the m bins. This removal of a ball from
    each bin is reversible, so it describes a bijection between the surjective arrangements and the
    arbitrary smaller arrangements. Using our result from above, there are (n−m)+m−1
    m−1 =
    n−1
    m−1 =
    n−1
    n−m such arrangements.
    To complete this discussion, we present two applications that require us to carefully consider
    which objects serve as balls and as bins.
    Example 22.2 A donut shop makes 7 different donut flavors. We’ll count how many different
    boxes of a dozen (12) donuts are possible. Here, we’re assuming that the position of the donuts
    in the box is irrelevant; we only care about how many of each flavor the box contains. We can
    view the n = 12 spots in the box as the “balls” and the m = 7 flavors as the bins since a donut
    arrangement tells how many of the spots are occupied by each flavor (read this carefully, as
    it’s easy to confuse which is which!). Thus, there are 12+7−1
    7−1 =
    18
    6 = 18, 564 different boxes
    possible.
    Suppose that there is an additional restriction that one donut of each flavor must be included.
    This stipulates that the map is surjective. Using our formula, there are 12−1
    7−1 =
    11
    6 = 462 such
    boxes.
    Example 22.3 We’ll count the number of non-negative integer solutions to the equation
    x + y + z = 7. Here, we think of the “balls” as the 7 units on the right side and the bins as the
    variables x, y and z. Applying our formula, there are 7+3−1
    3−1 =
    9
    2 = 36 such solutions.
    22.3 Indistinguishable Balls, Distinguishable Bins 200
    So far, we can fill in the following entries of our chart. We will finish filling out this chart in
    the next lecture.
    n Balls m Bins Arrangements Injective
    Arrangements
    Surjective
    Arrangements
    Distinguishable Distinguishable mn n!·
    m
    n
    Indistinguishable Distinguishablen+m−1
    m−1
    m
    n
    n−1
    m−1
  `;

  const input: ExtractionInput = {
    type: "text",
    content: studyText,
  };

  try {
    const concepts = await extractConceptsFromSource(input);

    printSummary(concepts);
    console.log(JSON.stringify(concepts, null, 2));
  } catch (err) {
    console.error("Test failed:", err);
  }
}

void main();
