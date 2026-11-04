'use strict';
/* Banque de thèmes de Bingmo (les "cartes").
   Chaque partie en tire quelques-uns au hasard, sans doublon. */
const BINGMO_THEMES = [
  // Culture & musique
  'Un instrument de musique', 'Un chanteur ou une chanteuse', 'Un groupe de musique', 'Un film d’animation',
  'Un acteur ou une actrice', 'Une série télé', 'Un dessin animé', 'Un jeu vidéo', 'Un jeu de société',
  'Un super-héros', 'Un personnage Disney', 'Un personnage de conte', 'Un monstre ou une créature',
  'Un dieu ou une déesse', 'Un peintre célèbre', 'Un scientifique célèbre', 'Un sportif célèbre',
  'Un livre ou une saga célèbre', 'Un réseau social ou une appli', 'Un site internet',

  // Manger & boire
  'Un fruit', 'Un légume', 'Un dessert', 'Un fromage', 'Une boisson', 'Un cocktail', 'Un bonbon',
  'Un parfum de glace', 'Une garniture de pizza', 'Un type de pâtes', 'Une épice ou une herbe',
  'Un plat en sauce', 'Un fast-food', 'Un truc qu’on mange au petit-déj', 'Un truc qu’on mange à l’apéro',
  'Un truc qu’on boit chaud', 'Un truc qu’on mange avec les doigts',

  // Animaux & nature
  'Un animal de la ferme', 'Un animal sauvage', 'Un animal de compagnie', 'Un animal marin', 'Un oiseau',
  'Un insecte', 'Un animal qui fait peur', 'Un dinosaure', 'Un cri d’animal', 'Une fleur', 'Un arbre',
  'Un truc dans le ciel', 'Une saison', 'Un fleuve ou une rivière',

  // Monde & lieux
  'Un pays', 'Une capitale', 'Une ville française', 'Une langue', 'Un monument célèbre',
  'Un moyen de transport', 'Une monnaie', 'Un mois de l’année', 'Un nombre entre 1 et 20',
  'Une lettre de l’alphabet', 'Une forme géométrique', 'Une couleur', 'Une matière', 'Un métal',

  // Maison & objets
  'Un objet du quotidien', 'Un meuble', 'Une pièce de la maison', 'Un outil de bricolage',
  'Un ustensile de cuisine', 'Un électroménager', 'Un appareil électronique', 'Un vêtement',
  'Une chaussure', 'Un accessoire de plage', 'Un cadeau de Noël', 'Un métier', 'Un sport',
  'Un prénom de fille', 'Un prénom de garçon', 'Une partie du corps', 'Un organe',

  // "Dans un…" / "À…"
  'Un truc dans une trousse', 'Un truc dans un frigo', 'Un truc dans une salle de bain',
  'Un truc dans un sac à main', 'Un truc dans une cuisine', 'Un truc dans un garage',
  'Un truc dans une valise', 'Un truc dans une chambre d’enfant', 'Un truc dans un bureau',
  'Un truc dans une forêt', 'Un truc dans l’espace', 'Un truc à la plage', 'Un truc à la montagne',
  'Un truc à la piscine', 'Un truc au cirque', 'Un truc à l’école', 'Un truc à l’hôpital',
  'Un truc au supermarché', 'Un truc au restaurant', 'Un truc au cinéma', 'Un truc au zoo',
  'Un truc à Noël', 'Un truc à Halloween', 'Un truc à un mariage', 'Un truc à un anniversaire',
  'Un truc à la fête foraine', 'Un truc à la pharmacie',

  // Univers
  'Un truc de magicien', 'Un truc de pirate', 'Un truc de chevalier', 'Un truc de cowboy',
  'Un truc de sorcière', 'Un super pouvoir',

  // Propriétés
  'Un truc rond', 'Un truc rouge', 'Un truc jaune', 'Un truc froid', 'Un truc chaud', 'Un truc collant',
  'Un truc qui fait du bruit', 'Un truc qui sent bon', 'Un truc qui sent mauvais', 'Un truc qui vole',
  'Un truc qui roule', 'Un truc qui flotte', 'Un truc qui pique', 'Un truc qui brille', 'Un truc mou',
  'Un truc dur', 'Un truc très long', 'Un truc minuscule', 'Un truc énorme', 'Un truc pointu',
  'Un truc transparent', 'Un truc qui commence par B', 'Un truc qui commence par P',

  // Verbes d'action
  'Un truc qu’on lance', 'Un truc qu’on gonfle', 'Un truc qu’on plie', 'Un truc qu’on casse',
  'Un truc qu’on allume', 'Un truc qu’on ouvre', 'Un truc qu’on perd tout le temps',
  'Un truc qu’on oublie souvent', 'Un truc qu’on cache', 'Un truc qu’on collectionne',

  // Humour & émotions
  'Un sentiment', 'Une qualité', 'Un défaut', 'Une phobie', 'Une onomatopée', 'Un mot doux',
  'Une excuse pour être en retard', 'Un truc dont on a peur', 'Un truc qui rend heureux',
  'Un truc qu’on regrette'
];
