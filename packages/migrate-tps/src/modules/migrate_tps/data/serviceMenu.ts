import type { ServiceMenuData } from './types'

export const SERVICE_MENU: ServiceMenuData = {
  nail: {
    tabId: 'nail',
    labelKey: 'serviceMenu.nail.tabLabel',
    label: 'Nail Services',
    categories: [
      {
        id: 'manicure-packages',
        type: 'package',
        labelKey: 'serviceMenu.packages.categories.manicurePackages.label',
        label: 'Manicure Packages',
        requirement: 'optional',
        mode: 'single',
        bundle: 'semi',
        items: [
          {
            id: 'manicure-essential',
            sku: 'MP01',
            nameKey: 'serviceMenu.packages.items.manicureEssential.name',
            name: 'Essential Manicure',
            descriptionKey: 'serviceMenu.packages.items.manicureEssential.desc',
            description: 'Dry Manicure + No Polish + Hand Massage 15 mins. Gentlemen Friendly',
            price: 290000
          },
          {
            id: 'manicure-relaxing',
            sku: 'MP02',
            nameKey: 'serviceMenu.packages.items.manicureRelaxing.name',
            name: 'Relaxing Manicure',
            descriptionKey: 'serviceMenu.packages.items.manicureRelaxing.desc',
            description: 'Dry Manicure + Polish + Hand Massage 15 mins',
            optionGroups: [
              {
                id: 'polish-type',
                labelKey: 'serviceMenu.packages.optionGroups.polishType.label',
                label: 'Polish Type',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'polish-regular',
                    nameKey: 'serviceMenu.packages.options.polishRegularType.name',
                    name: 'Regular Polish',
                    conflictsWithItems: ['builder-gel', 'extension-type', 'art-level'],
                    price: 400000
                  },
                  {
                    id: 'polish-gel',
                    nameKey: 'serviceMenu.packages.options.polishGelType.name',
                    name: 'Gel Polish',
                    price: 590000
                  }
                ]
              }
            ]
          },
          {
            id: 'manicure-signature',
            sku: 'MP03',
            nameKey: 'serviceMenu.packages.items.manicureSignature.name',
            name: 'Signature Manicure',
            descriptionKey: 'serviceMenu.packages.items.manicureSignature.desc',
            description: 'Dry Manicure + Polish + Privé Hand Mask + Hand Massage 10 mins',
            optionGroups: [
              {
                id: 'polish-type',
                labelKey: 'serviceMenu.packages.optionGroups.polishType.label',
                label: 'Polish Type',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'polish-regular',
                    nameKey: 'serviceMenu.packages.options.polishRegularType.name',
                    name: 'Regular Polish',
                    conflictsWithItems: ['builder-gel', 'extension-type', 'art-level'],
                    price: 490000
                  },
                  {
                    id: 'polish-gel',
                    nameKey: 'serviceMenu.packages.options.polishGelType.name',
                    name: 'Gel Polish',
                    price: 670000
                  }
                ]
              }
            ]
          },
          {
            id: 'manicure-loccitane',
            sku: 'MP04',
            nameKey: 'serviceMenu.packages.items.manicureLoccitane.name',
            name: "L'Occitane Manicure (Almond Delicious)",
            descriptionKey: 'serviceMenu.packages.items.manicureLoccitane.desc',
            description: 'Dry Manicure + Polish + Cleansing Oil + Exfoliation + Hand Mask + Almond Hand Cream',
            optionGroups: [
              {
                id: 'polish-type',
                labelKey: 'serviceMenu.packages.optionGroups.polishType.label',
                label: 'Polish Type',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'polish-regular',
                    nameKey: 'serviceMenu.packages.options.polishRegularType.name',
                    name: 'Regular Polish',
                    conflictsWithItems: ['builder-gel', 'extension-type', 'art-level'],
                    price: 570000
                  },
                  {
                    id: 'polish-gel',
                    nameKey: 'serviceMenu.packages.options.polishGelType.name',
                    name: 'Gel Polish',
                    price: 770000
                  }
                ]
              }
            ]
          },
          {
            id: 'manicure-premium',
            sku: 'MP05',
            nameKey: 'serviceMenu.packages.items.manicurePremium.name',
            name: 'Premium Manicure',
            descriptionKey: 'serviceMenu.packages.items.manicurePremium.desc',
            description: 'Dry Manicure + Polish + CND Premium Hand Mask + Hand Massage 30 mins',
            optionGroups: [
              {
                id: 'polish-type',
                labelKey: 'serviceMenu.packages.optionGroups.polishType.label',
                label: 'Polish Type',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'polish-regular',
                    nameKey: 'serviceMenu.packages.options.polishRegularType.name',
                    name: 'Regular Polish',
                    conflictsWithItems: ['builder-gel', 'extension-type', 'art-level'],
                    price: 860000
                  },
                  {
                    id: 'polish-gel',
                    nameKey: 'serviceMenu.packages.options.polishGelType.name',
                    name: 'Gel Polish',
                    price: 1040000
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: 'pedicure-packages',
        type: 'package',
        labelKey: 'serviceMenu.packages.categories.pedicurePackages.label',
        label: 'Pedicure Packages',
        requirement: 'optional',
        mode: 'single',
        bundle: 'semi',
        items: [
          {
            id: 'pedicure-essential',
            sku: 'PP01',
            nameKey: 'serviceMenu.packages.items.pedicureEssential.name',
            name: 'Essential Pedicure',
            descriptionKey: 'serviceMenu.packages.items.pedicureEssential.desc',
            description: 'Dry Pedicure + No Polish + Heel Treatment (scrub & cream). Gentlemen Friendly',
            price: 410000
          },
          {
            id: 'pedicure-relaxing',
            sku: 'PP02',
            nameKey: 'serviceMenu.packages.items.pedicureRelaxing.name',
            name: 'Relaxing Pedicure',
            descriptionKey: 'serviceMenu.packages.items.pedicureRelaxing.desc',
            description: 'Dry Pedicure + Polish + Foot Massage 15 mins',
            optionGroups: [
              {
                id: 'polish-type',
                labelKey: 'serviceMenu.packages.optionGroups.polishType.label',
                label: 'Polish Type',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'polish-regular',
                    nameKey: 'serviceMenu.packages.options.polishRegularType.name',
                    name: 'Regular Polish',
                    conflictsWithItems: ['builder-gel', 'extension-type', 'art-level'],
                    price: 400000
                  },
                  {
                    id: 'polish-gel',
                    nameKey: 'serviceMenu.packages.options.polishGelType.name',
                    name: 'Gel Polish',
                    price: 580000
                  }
                ]
              }
            ]
          },
          {
            id: 'pedicure-basic',
            sku: 'PP03',
            nameKey: 'serviceMenu.packages.items.pedicureBasic.name',
            name: 'Basic Pedicure',
            descriptionKey: 'serviceMenu.packages.items.pedicureBasic.desc',
            description: 'Dry Pedicure + Polish + Heel Treatment (scrub & cream)',
            optionGroups: [
              {
                id: 'polish-type',
                labelKey: 'serviceMenu.packages.optionGroups.polishType.label',
                label: 'Polish Type',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'polish-regular',
                    nameKey: 'serviceMenu.packages.options.polishRegularType.name',
                    name: 'Regular Polish',
                    conflictsWithItems: ['builder-gel', 'extension-type', 'art-level'],
                    price: 520000
                  },
                  {
                    id: 'polish-gel',
                    nameKey: 'serviceMenu.packages.options.polishGelType.name',
                    name: 'Gel Polish',
                    price: 700000
                  }
                ]
              }
            ]
          },
          {
            id: 'pedicure-muscle-relief',
            sku: 'PP04',
            nameKey: 'serviceMenu.packages.items.pedicureMuscleRelief.name',
            name: 'Muscle Relief Pedicure',
            descriptionKey: 'serviceMenu.packages.items.pedicureMuscleRelief.desc',
            description: 'Dry Pedicure + Polish + Foot Massage 30 mins',
            optionGroups: [
              {
                id: 'polish-type',
                labelKey: 'serviceMenu.packages.optionGroups.polishType.label',
                label: 'Polish Type',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'polish-regular',
                    nameKey: 'serviceMenu.packages.options.polishRegularType.name',
                    name: 'Regular Polish',
                    conflictsWithItems: ['builder-gel', 'extension-type', 'art-level'],
                    price: 550000
                  },
                  {
                    id: 'polish-gel',
                    nameKey: 'serviceMenu.packages.options.polishGelType.name',
                    name: 'Gel Polish',
                    price: 730000
                  }
                ]
              }
            ]
          },
          {
            id: 'pedicure-deluxe',
            sku: 'PP05',
            nameKey: 'serviceMenu.packages.items.pedicureDeluxe.name',
            name: 'Deluxe Pedicure',
            descriptionKey: 'serviceMenu.packages.items.pedicureDeluxe.desc',
            description: 'Dry Pedicure + Polish + Heel Treatment + Foot Massage 15 mins',
            optionGroups: [
              {
                id: 'polish-type',
                labelKey: 'serviceMenu.packages.optionGroups.polishType.label',
                label: 'Polish Type',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'polish-regular',
                    nameKey: 'serviceMenu.packages.options.polishRegularType.name',
                    name: 'Regular Polish',
                    conflictsWithItems: ['builder-gel', 'extension-type', 'art-level'],
                    price: 690000
                  },
                  {
                    id: 'polish-gel',
                    nameKey: 'serviceMenu.packages.options.polishGelType.name',
                    name: 'Gel Polish',
                    price: 870000
                  }
                ]
              }
            ]
          },
          {
            id: 'pedicure-signature',
            sku: 'PP06',
            nameKey: 'serviceMenu.packages.items.pedicureSignature.name',
            name: 'Signature Pedicure',
            descriptionKey: 'serviceMenu.packages.items.pedicureSignature.desc',
            description: 'Dry Pedicure + Polish + Heel Treatment + Privé Foot Mask + Foot Massage 15 mins',
            optionGroups: [
              {
                id: 'polish-type',
                labelKey: 'serviceMenu.packages.optionGroups.polishType.label',
                label: 'Polish Type',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'polish-regular',
                    nameKey: 'serviceMenu.packages.options.polishRegularType.name',
                    name: 'Regular Polish',
                    conflictsWithItems: ['builder-gel', 'extension-type', 'art-level'],
                    price: 810000
                  },
                  {
                    id: 'polish-gel',
                    nameKey: 'serviceMenu.packages.options.polishGelType.name',
                    name: 'Gel Polish',
                    price: 990000
                  }
                ]
              }
            ]
          },
          {
            id: 'pedicure-premium',
            sku: 'PP07',
            nameKey: 'serviceMenu.packages.items.pedicurePremium.name',
            name: 'Premium Pedicure',
            descriptionKey: 'serviceMenu.packages.items.pedicurePremium.desc',
            description: 'Dry Pedicure + Polish + Heel Treatment + Foot Massage 30 mins',
            optionGroups: [
              {
                id: 'polish-type',
                labelKey: 'serviceMenu.packages.optionGroups.polishType.label',
                label: 'Polish Type',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'polish-regular',
                    nameKey: 'serviceMenu.packages.options.polishRegularType.name',
                    name: 'Regular Polish',
                    conflictsWithItems: ['builder-gel', 'extension-type', 'art-level'],
                    price: 840000
                  },
                  {
                    id: 'polish-gel',
                    nameKey: 'serviceMenu.packages.options.polishGelType.name',
                    name: 'Gel Polish',
                    price: 1020000
                  }
                ]
              }
            ]
          },
          {
            id: 'pedicure-royal',
            sku: 'PP08',
            nameKey: 'serviceMenu.packages.items.pedicureRoyal.name',
            name: 'Royal Pedicure',
            descriptionKey: 'serviceMenu.packages.items.pedicureRoyal.desc',
            description:
              'Dry Pedicure + Polish + Heel Treatment + Foot Soak + Exfoliation + Foot Mask + Foot Massage 15 mins',
            optionGroups: [
              {
                id: 'polish-type',
                labelKey: 'serviceMenu.packages.optionGroups.polishType.label',
                label: 'Polish Type',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'polish-regular',
                    nameKey: 'serviceMenu.packages.options.polishRegularType.name',
                    name: 'Regular Polish',
                    conflictsWithItems: ['builder-gel', 'extension-type', 'art-level'],
                    price: 1020000
                  },
                  {
                    id: 'polish-gel',
                    nameKey: 'serviceMenu.packages.options.polishGelType.name',
                    name: 'Gel Polish',
                    price: 1200000
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: 'dry-cuticle-care',
        type: 'service',
        labelKey: 'serviceMenu.nail.categories.dryCuticleCare.label',
        label: 'Dry Cuticle Care',
        noteKey: 'serviceMenu.nail.categories.dryCuticleCare.note',
        note: 'Gentlemen Friendly',
        requirement: 'optional', //  không ép phải chọn nhóm này (vì có nhóm khác)
        mode: 'single', // [V] chọn 1 item trong category
        items: [
          {
            id: 'cuticle-prive-technique',
            sku: 'DCC01',
            nameKey: 'serviceMenu.nail.items.cuticlePriveTechnique.name',
            name: 'Privé™ Technique',
            durationKey: 'serviceMenu.common.duration.45m',
            duration: '45 mins',
            descriptionKey: 'serviceMenu.nail.items.cuticlePriveTechnique.desc',
            description: 'Standard cuticle care technique',
            optionGroups: [
              {
                id: 'service-scope',
                labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                label: 'Service Scope',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'scope-mani',
                    nameKey: 'serviceMenu.nail.options.scopeMani.name',
                    name: 'Manicure',
                    price: 125000
                  },
                  {
                    id: 'scope-pedi',
                    nameKey: 'serviceMenu.nail.options.scopePedi.name',
                    name: 'Pedicure',
                    price: 125000
                  },
                  {
                    id: 'scope-both',
                    nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                    name: 'Mani + Pedi',
                    price: 240000
                  }
                ]
              }
            ]
          },
          {
            id: 'cuticle-efile',
            sku: 'DCC02',
            nameKey: 'serviceMenu.nail.items.cuticleEfile.name',
            name: 'E-File Cuticle Technique',
            durationKey: 'serviceMenu.common.duration.90m',
            duration: '90 mins',
            descriptionKey: 'serviceMenu.nail.items.cuticleEfile.desc',
            description: 'Advanced technique using E-File. Gentlemen friendly',
            optionGroups: [
              {
                id: 'service-scope',
                labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                label: 'Service Scope',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'scope-mani',
                    nameKey: 'serviceMenu.nail.options.scopeMani.name',
                    name: 'Manicure',
                    price: 440000
                  },
                  {
                    id: 'scope-pedi',
                    nameKey: 'serviceMenu.nail.options.scopePedi.name',
                    name: 'Pedicure',
                    price: 440000
                  },
                  {
                    id: 'scope-both',
                    nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                    name: 'Mani + Pedi',
                    price: 860000
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: 'nail-service',
        type: 'service',
        labelKey: 'serviceMenu.nail.categories.nailServices.label',
        label: 'Nail Services',
        requirement: 'optional',
        mode: 'multiple', // Có thể chọn nhiều items
        items: [
          {
            id: 'builder-gel',
            sku: 'NS01',
            nameKey: 'serviceMenu.nail.items.builderGel.name',
            name: 'Builder Gel',
            descriptionKey: 'serviceMenu.nail.items.builderGel.desc',
            description: 'For a fuller nail shape & weak nails to last longer',
            // Note: No item-level conflict. Regular Polish conflicts via option-level conflictsWithItems
            optionGroups: [
              {
                id: 'builder-type',
                labelKey: 'serviceMenu.nail.optionGroups.builderType.label',
                label: 'Builder Type',
                requirement: 'required',
                mode: 'multiple',
                options: [
                  {
                    id: 'gelish-structure',
                    nameKey: 'serviceMenu.nail.options.gelishStructure.name',
                    name: 'Gelish Structure Gel',
                    conflictsWithItems: ['polish'], // Conflicts with Regular Polish (type-regular)
                    nextGroups: [
                      {
                        id: 'nail-length',
                        labelKey: 'serviceMenu.nail.optionGroups.nailLength.label',
                        label: 'Nail Length',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'short-medium',
                            nameKey: 'serviceMenu.nail.options.shortMedium.name',
                            name: 'Short / Medium',
                            nextGroups: [
                              {
                                id: 'service-scope',
                                labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                label: 'Service Scope',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'scope-mani',
                                    nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                    name: 'Manicure',
                                    price: 225000
                                  },
                                  {
                                    id: 'scope-pedi',
                                    nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                    name: 'Pedicure',
                                    price: 225000
                                  },
                                  {
                                    id: 'scope-both',
                                    nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                    name: 'Mani + Pedi',
                                    price: 430000
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'long-extra-long',
                            nameKey: 'serviceMenu.nail.options.longExtraLong.name',
                            name: 'Long / Extra Long',
                            nextGroups: [
                              {
                                id: 'service-scope',
                                labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                label: 'Service Scope',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'scope-mani',
                                    nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                    name: 'Manicure',
                                    price: 285000
                                  },
                                  {
                                    id: 'scope-pedi',
                                    nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                    name: 'Pedicure',
                                    price: 285000
                                  },
                                  {
                                    id: 'scope-both',
                                    nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                    name: 'Mani + Pedi',
                                    price: 545000
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  },
                  {
                    id: 'plexigel-overlay',
                    nameKey: 'serviceMenu.nail.options.plexigelOverlay.name',
                    name: 'CND™ Plexigel Build Overlay',
                    conflictsWithItems: ['polish'], // Conflicts with Regular Polish (type-regular)
                    nextGroups: [
                      {
                        id: 'nail-length',
                        labelKey: 'serviceMenu.nail.optionGroups.nailLength.label',
                        label: 'Nail Length',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'length-short',
                            nameKey: 'serviceMenu.nail.options.lengthShort.name',
                            name: 'Short / Medium',
                            nextGroups: [
                              {
                                id: 'service-scope',
                                labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                label: 'Service Scope',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'scope-mani',
                                    nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                    name: 'Manicure',
                                    price: 585000
                                  },
                                  {
                                    id: 'scope-pedi',
                                    nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                    name: 'Pedicure',
                                    price: 585000
                                  },
                                  {
                                    id: 'scope-both',
                                    nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                    name: 'Mani + Pedi',
                                    price: 1120000
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'length-long',
                            nameKey: 'serviceMenu.nail.options.lengthLong.name',
                            name: 'Long / Extra Long',
                            nextGroups: [
                              {
                                id: 'service-scope',
                                labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                label: 'Service Scope',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'scope-mani',
                                    nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                    name: 'Manicure',
                                    price: 815000
                                  },
                                  {
                                    id: 'scope-pedi',
                                    nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                    name: 'Pedicure',
                                    price: 815000
                                  },
                                  {
                                    id: 'scope-both',
                                    nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                    name: 'Mani + Pedi',
                                    price: 1560000
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },

          {
            id: 'polish',
            sku: 'NS02',
            nameKey: 'serviceMenu.nail.items.polish.name',
            name: 'Nail Polish',
            descriptionKey: 'serviceMenu.nail.items.polish.desc',
            description: 'Included Nail Care - Privé™ Technique',
            include: { itemId: 'cuticle-prive-technique', locked: false },
            optionGroups: [
              {
                id: 'polish-type',
                labelKey: 'serviceMenu.nail.optionGroups.polishType.label',
                label: 'Polish Type',
                requirement: 'required',
                mode: 'multiple',
                options: [
                  {
                    id: 'type-regular',
                    nameKey: 'serviceMenu.nail.options.polishTypeRegular.name',
                    name: 'Regular Polish',
                    durationKey: 'serviceMenu.common.duration.45m',
                    duration: '45 mins',
                    noteKey: 'serviceMenu.nail.options.note.includedNailCare',
                    note: 'Included Dry Cuticle Care - Privé™ Technique',
                    conflictsWithItems: ['builder-gel', 'extension-type', 'art-level'],
                    nextGroups: [
                      {
                        id: 'technique',
                        labelKey: 'serviceMenu.nail.optionGroups.cuticleTechnique.label',
                        label: 'Cuticle Technique',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'technique-nails-inc',
                            nameKey: 'serviceMenu.nail.options.techniqueNailsInc.name',
                            name: 'Nails Inc',
                            nextGroups: [
                              {
                                id: 'service-scope',
                                labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                label: 'Service Scope',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'scope-mani',
                                    nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                    name: 'Manicure',
                                    price: 235000
                                  },
                                  {
                                    id: 'scope-pedi',
                                    nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                    name: 'Pedicure',
                                    price: 235000
                                  },
                                  {
                                    id: 'scope-both',
                                    nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                    name: 'Mani + Pedi',
                                    price: 460000
                                  }
                                ]
                              },
                              {
                                id: 'upgrade-technique-efile',
                                labelKey: 'serviceMenu.nail.optionGroups.techniqueEfile.label',
                                label: 'Upgrade E-File Cuticle Technique',
                                requirement: 'optional',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'efile-single',
                                    nameKey: 'serviceMenu.nail.options.efileSingle.name',
                                    name: 'Manicure / Pedicure',
                                    price: 205000
                                  },
                                  {
                                    id: 'efile-both',
                                    nameKey: 'serviceMenu.nail.options.efileBoth.name',
                                    name: 'Mani + Pedi',
                                    price: 400000
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  },
                  {
                    id: 'type-gel',
                    nameKey: 'serviceMenu.nail.options.polishTypeGel.name',
                    name: 'Gel Polish',
                    descriptionKey: 'serviceMenu.nail.options.polishTypeGel.desc',
                    durationKey: 'serviceMenu.common.duration.60m',
                    duration: '60 mins',
                    noteKey: 'serviceMenu.nail.options.note.includedNailCare',
                    note: 'Included Dry Cuticle Care - Privé™ Technique',
                    nextGroups: [
                      {
                        id: 'brand',
                        labelKey: 'serviceMenu.nail.optionGroups.brand.label',
                        label: 'Brand',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'brand-estemio',
                            nameKey: 'serviceMenu.nail.options.brandEstemio.name',
                            name: 'Estemio',
                            descriptionKey: 'serviceMenu.nail.options.brandEstemio.desc',
                            description:
                              'Regular nail polish with a natural finish. Ideal for short-term wear and easy removal.',
                            nextGroups: [
                              {
                                id: 'service-scope',
                                labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                label: 'Service Scope',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'scope-mani',
                                    nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                    name: 'Manicure',
                                    price: 360000
                                  },
                                  {
                                    id: 'scope-pedi',
                                    nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                    name: 'Pedicure',
                                    price: 360000
                                  },
                                  {
                                    id: 'scope-both',
                                    nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                    name: 'Mani + Pedi',
                                    price: 710000
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'brand-cnd',
                            nameKey: 'serviceMenu.nail.options.brandCnd.name',
                            name: 'CND™ Shellac',
                            descriptionKey: 'serviceMenu.nail.options.brandCnd.desc',
                            description:
                              'Lightweight gel polish with long-lasting shine and chip resistance. Cured under LED/UV.',
                            nextGroups: [
                              {
                                id: 'service-scope',
                                labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                label: 'Service Scope',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'scope-mani',
                                    nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                    name: 'Manicure',
                                    price: 415000
                                  },
                                  {
                                    id: 'scope-pedi',
                                    nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                    name: 'Pedicure',
                                    price: 415000
                                  },
                                  {
                                    id: 'scope-both',
                                    nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                    name: 'Mani + Pedi',
                                    price: 820000
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'brand-tgb',
                            nameKey: 'serviceMenu.nail.options.brandTgb.name',
                            name: 'THE GEL BOTTLE COLORS',
                            descriptionKey: 'serviceMenu.nail.options.brandTgb.desc',
                            description: 'Premium gel polish with high pigmentation and a glossy, durable finish.',
                            nextGroups: [
                              {
                                id: 'service-scope',
                                labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                label: 'Service Scope',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'scope-mani',
                                    nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                    name: 'Manicure',
                                    price: 415000
                                  },
                                  {
                                    id: 'scope-pedi',
                                    nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                    name: 'Pedicure',
                                    price: 415000
                                  },
                                  {
                                    id: 'scope-both',
                                    nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                    name: 'Mani + Pedi',
                                    price: 820000
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'brand-biab',
                            nameKey: 'serviceMenu.nail.options.brandBiab.name',
                            name: 'BIAB TM COLORS',
                            descriptionKey: 'serviceMenu.nail.options.brandBiab.desc',
                            description:
                              'Builder gel with color that strengthens natural nails while providing long-lasting wear.',
                            nextGroups: [
                              {
                                id: 'service-scope',
                                labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                label: 'Service Scope',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'scope-mani',
                                    nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                    name: 'Manicure',
                                    price: 710000
                                  },
                                  {
                                    id: 'scope-pedi',
                                    nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                    name: 'Pedicure',
                                    price: 710000
                                  },
                                  {
                                    id: 'scope-both',
                                    nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                    name: 'Mani + Pedi',
                                    price: 1410000
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      },
                      {
                        id: 'upgrade-technique-efile',
                        labelKey: 'serviceMenu.nail.optionGroups.techniqueEfile.label',
                        label: 'Upgrade E-File Cuticle Technique',
                        requirement: 'optional',
                        mode: 'single',
                        options: [
                          {
                            id: 'efile-single',
                            nameKey: 'serviceMenu.nail.options.efileSingle.name',
                            name: 'Manicure / Pedicure',
                            price: 205000
                          },
                          {
                            id: 'efile-both',
                            nameKey: 'serviceMenu.nail.options.efileBoth.name',
                            name: 'Mani + Pedi',
                            price: 400000
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              {
                id: 'add-ons',
                labelKey: 'serviceMenu.nail.optionGroups.addOns.label',
                label: 'Add-ons',
                requirement: 'optional',
                mode: 'multiple',
                options: [
                  {
                    id: 'addon-extra-colors',
                    nameKey: 'serviceMenu.nail.options.addonExtraColors.name',
                    name: 'Over 2 Colors for Nail Polish',
                    price: 25000,
                    unitKey: 'serviceMenu.common.unit.perColor',
                    unit: 'per color'
                  },
                  {
                    id: 'addon-buffer-shine',
                    nameKey: 'serviceMenu.nail.options.addonBufferShine.name',
                    name: 'Buffer Shine on Natural Nail',
                    price: 45000,
                    unitKey: 'serviceMenu.common.unit.perSet10',
                    unit: 'per set (x10)'
                  },
                  {
                    id: 'addon-ingrown',
                    nameKey: 'serviceMenu.nail.options.addonIngrown.name',
                    name: 'Ingrown Nail Treatment',
                    price: 65000,
                    unitKey: 'serviceMenu.common.unit.perNail',
                    unit: 'per nail'
                  },
                  {
                    id: 'gel-polish-long-nail',
                    nameKey: 'serviceMenu.nail.options.gelPolishLongNail.name',
                    name: 'Gel Polish for Long Nails',
                    price: 95000,
                    unitKey: 'serviceMenu.common.unit.perSet10',
                    unit: 'per set (x10)'
                  },
                  {
                    id: 'addon-top-coat',
                    nameKey: 'serviceMenu.nail.options.addonTopCoat.name',
                    name: 'Extra Top Coat',
                    price: 100000,
                    unitKey: 'serviceMenu.common.unit.perLayer',
                    unit: 'per layer'
                  }
                ]
              }
            ]
          },

          {
            id: 'removal',
            sku: 'NS03',
            nameKey: 'serviceMenu.nail.items.removal.name',
            name: 'Nail Removal',
            descriptionKey: 'serviceMenu.nail.items.removal.desc',
            description: 'Gel or Drill removal service',
            optionGroups: [
              {
                id: 'removal-type',
                labelKey: 'serviceMenu.nail.optionGroups.removalType.label',
                label: 'Removal Type',
                requirement: 'required',
                mode: 'multiple',
                options: [
                  {
                    id: 'type-gel',
                    nameKey: 'serviceMenu.nail.options.removalTypeGel.name',
                    name: 'Gel Polish Soak-Off Removal',
                    nextGroups: [
                      {
                        id: 'service-scope',
                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                        label: 'Service Scope',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'scope-mani',
                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                            name: 'Manicure',
                            price: 75000
                          },
                          {
                            id: 'scope-pedi',
                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                            name: 'Pedicure',
                            price: 75000
                          },
                          {
                            id: 'scope-both',
                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                            name: 'Mani + Pedi',
                            price: 140000
                          }
                        ]
                      }
                    ]
                  },
                  {
                    id: 'type-drill',
                    nameKey: 'serviceMenu.nail.options.removalTypeDrill.name',
                    name: 'Hard Gel / Builder Gel Drill Removal',
                    nextGroups: [
                      {
                        id: 'service-scope',
                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                        label: 'Service Scope',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'scope-mani',
                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                            name: 'Manicure',
                            price: 165000
                          },
                          {
                            id: 'scope-pedi',
                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                            name: 'Pedicure',
                            price: 165000
                          },
                          {
                            id: 'scope-both',
                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                            name: 'Mani + Pedi',
                            price: 315000
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: 'nail-arts',
        labelKey: 'serviceMenu.nail.categories.nailArts.label',
        label: 'Nail Arts',
        requirement: 'optional',
        mode: 'single',
        items: [
          {
            id: 'art-level',
            sku: 'NA01',
            nameKey: 'serviceMenu.nail.items.artLevel.name',
            name: 'Nail Art',
            descriptionKey: 'serviceMenu.nail.items.artLevel.desc',
            description: 'Professional nail art designs from Level 1 to Level 5',
            optionGroups: [
              {
                id: 'service-scope',
                labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                label: 'Service Scope',
                requirement: 'required',
                mode: 'multiple',
                options: [
                  {
                    id: 'service-scope-manicure',
                    nameKey: 'serviceMenu.nail.options.scopeMani.name',
                    name: 'Manicure',
                    price: { kind: 'range', min: 55000, max: 240000 },
                    conflictsWithItems: ['polish']
                  },
                  {
                    id: 'service-scope-pedicure',
                    nameKey: 'serviceMenu.nail.options.scopePedi.name',
                    name: 'Pedicure',
                    price: { kind: 'range', min: 55000, max: 240000 },
                    conflictsWithItems: ['polish']
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: 'nail-extensions',
        labelKey: 'serviceMenu.nail.categories.nailExtensions.label',
        label: 'Nail Extensions',
        requirement: 'optional',
        mode: 'single',
        items: [
          {
            id: 'extension-type',
            sku: 'NE01',
            nameKey: 'serviceMenu.nail.items.extensionType.name',
            name: 'Nail Extensions',
            descriptionKey: 'serviceMenu.nail.items.extensionType.desc',
            description: 'Achieve the perfect length with our professional Full Set or Refill services',
            // Note: No item-level conflict. Regular Polish conflicts via option-level conflictsWithItems
            optionGroups: [
              {
                id: 'extension-type-selection',
                labelKey: 'serviceMenu.nail.optionGroups.extensionTypeSelection.label',
                label: 'Select Type',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'full-set',
                    nameKey: 'serviceMenu.nail.options.extensionFullSet.name',
                    name: 'Full Set',
                    conflictsWithItems: ['polish'], // Conflicts with Regular Polish (type-regular)
                    nextGroups: [
                      {
                        id: 'service-type',
                        labelKey: 'serviceMenu.nail.optionGroups.serviceType.label',
                        label: 'Service Type',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'service-plexigel',
                            nameKey: 'serviceMenu.nail.options.servicePlexigel.name',
                            name: 'CND™ Plexigel',
                            duration: '60 - 90 mins',
                            nextGroups: [
                              {
                                id: 'nail-length',
                                labelKey: 'serviceMenu.nail.optionGroups.nailLength.label',
                                label: 'Nail Length',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'length-short',
                                    nameKey: 'serviceMenu.nail.options.lengthShort.name',
                                    name: 'Short / Medium',
                                    nextGroups: [
                                      {
                                        id: 'service-scope',
                                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                        label: 'Service Scope',
                                        requirement: 'required',
                                        mode: 'single',
                                        options: [
                                          {
                                            id: 'scope-mani',
                                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                            name: 'Manicure',
                                            price: 995000
                                          },
                                          {
                                            id: 'scope-pedi',
                                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                            name: 'Pedicure',
                                            price: 995000
                                          },
                                          {
                                            id: 'scope-both',
                                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                            name: 'Mani + Pedi',
                                            price: 1900000
                                          }
                                        ]
                                      }
                                    ]
                                  },
                                  {
                                    id: 'length-long',
                                    nameKey: 'serviceMenu.nail.options.lengthLong.name',
                                    name: 'Long / Extra Long',
                                    nextGroups: [
                                      {
                                        id: 'service-scope',
                                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                        label: 'Service Scope',
                                        requirement: 'required',
                                        mode: 'single',
                                        options: [
                                          {
                                            id: 'scope-mani',
                                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                            name: 'Manicure',
                                            price: 1225000
                                          },
                                          {
                                            id: 'scope-pedi',
                                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                            name: 'Pedicure',
                                            price: 1225000
                                          },
                                          {
                                            id: 'scope-both',
                                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                            name: 'Mani + Pedi',
                                            price: 2350000
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'service-acrylic',
                            nameKey: 'serviceMenu.nail.options.serviceAcrylic.name',
                            name: 'Acrylic',
                            duration: '60 - 90 mins',
                            nextGroups: [
                              {
                                id: 'nail-length',
                                labelKey: 'serviceMenu.nail.optionGroups.nailLength.label',
                                label: 'Nail Length',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'length-short',
                                    nameKey: 'serviceMenu.nail.options.lengthShort.name',
                                    name: 'Short / Medium',
                                    nextGroups: [
                                      {
                                        id: 'service-scope',
                                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                        label: 'Service Scope',
                                        requirement: 'required',
                                        mode: 'single',
                                        options: [
                                          {
                                            id: 'scope-mani',
                                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                            name: 'Manicure',
                                            price: 685000
                                          },
                                          {
                                            id: 'scope-pedi',
                                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                            name: 'Pedicure',
                                            price: 685000
                                          },
                                          {
                                            id: 'scope-both',
                                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                            name: 'Mani + Pedi',
                                            price: 1310000
                                          }
                                        ]
                                      }
                                    ]
                                  },
                                  {
                                    id: 'length-long',
                                    nameKey: 'serviceMenu.nail.options.lengthLong.name',
                                    name: 'Long / Extra Long',
                                    nextGroups: [
                                      {
                                        id: 'service-scope',
                                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                        label: 'Service Scope',
                                        requirement: 'required',
                                        mode: 'single',
                                        options: [
                                          {
                                            id: 'scope-mani',
                                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                            name: 'Manicure',
                                            price: 915000
                                          },
                                          {
                                            id: 'scope-pedi',
                                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                            name: 'Pedicure',
                                            price: 915000
                                          },
                                          {
                                            id: 'scope-both',
                                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                            name: 'Mani + Pedi',
                                            price: 1750000
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'service-hard-gel',
                            nameKey: 'serviceMenu.nail.options.serviceHardGel.name',
                            name: 'Hard Gel',
                            duration: '60 - 90 mins',
                            nextGroups: [
                              {
                                id: 'nail-length',
                                labelKey: 'serviceMenu.nail.optionGroups.nailLength.label',
                                label: 'Nail Length',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'length-short',
                                    nameKey: 'serviceMenu.nail.options.lengthShort.name',
                                    name: 'Short / Medium',
                                    nextGroups: [
                                      {
                                        id: 'service-scope',
                                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                        label: 'Service Scope',
                                        requirement: 'required',
                                        mode: 'single',
                                        options: [
                                          {
                                            id: 'scope-mani',
                                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                            name: 'Manicure',
                                            price: 915000
                                          },
                                          {
                                            id: 'scope-pedi',
                                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                            name: 'Pedicure',
                                            price: 915000
                                          },
                                          {
                                            id: 'scope-both',
                                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                            name: 'Mani + Pedi',
                                            price: 1750000
                                          }
                                        ]
                                      }
                                    ]
                                  },
                                  {
                                    id: 'length-long',
                                    nameKey: 'serviceMenu.nail.options.lengthLong.name',
                                    name: 'Long / Extra Long',
                                    nextGroups: [
                                      {
                                        id: 'service-scope',
                                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                        label: 'Service Scope',
                                        requirement: 'required',
                                        mode: 'single',
                                        options: [
                                          {
                                            id: 'scope-mani',
                                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                            name: 'Manicure',
                                            price: 1135000
                                          },
                                          {
                                            id: 'scope-pedi',
                                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                            name: 'Pedicure',
                                            price: 1135000
                                          },
                                          {
                                            id: 'scope-both',
                                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                            name: 'Mani + Pedi',
                                            price: 2175000
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'service-gel-x-express',
                            nameKey: 'serviceMenu.nail.options.serviceGelXExpress.name',
                            name: 'Gel-X® Express',
                            duration: '45 mins',
                            nextGroups: [
                              {
                                id: 'nail-length',
                                labelKey: 'serviceMenu.nail.optionGroups.nailLength.label',
                                label: 'Nail Length',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'length-short',
                                    nameKey: 'serviceMenu.nail.options.lengthShort.name',
                                    name: 'Short / Medium',
                                    nextGroups: [
                                      {
                                        id: 'service-scope',
                                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                        label: 'Service Scope',
                                        requirement: 'required',
                                        mode: 'single',
                                        options: [
                                          {
                                            id: 'scope-mani',
                                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                            name: 'Manicure',
                                            price: 585000
                                          },
                                          {
                                            id: 'scope-pedi',
                                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                            name: 'Pedicure',
                                            price: 585000
                                          },
                                          {
                                            id: 'scope-both',
                                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                            name: 'Mani + Pedi',
                                            price: 1120000
                                          }
                                        ]
                                      }
                                    ]
                                  },
                                  {
                                    id: 'length-long',
                                    nameKey: 'serviceMenu.nail.options.lengthLong.name',
                                    name: 'Long / Extra Long',
                                    nextGroups: [
                                      {
                                        id: 'service-scope',
                                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                        label: 'Service Scope',
                                        requirement: 'required',
                                        mode: 'single',
                                        options: [
                                          {
                                            id: 'scope-mani',
                                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                            name: 'Manicure',
                                            price: 815000
                                          },
                                          {
                                            id: 'scope-pedi',
                                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                            name: 'Pedicure',
                                            price: 815000
                                          },
                                          {
                                            id: 'scope-both',
                                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                            name: 'Mani + Pedi',
                                            price: 1560000
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  },
                  {
                    id: 'refills',
                    nameKey: 'serviceMenu.nail.options.extensionRefills.name',
                    name: 'Refills',
                    conflictsWithItems: ['polish'], // Conflicts with Regular Polish (type-regular)
                    nextGroups: [
                      {
                        id: 'service-type',
                        labelKey: 'serviceMenu.nail.optionGroups.serviceType.label',
                        label: 'Service Type',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'service-acrylic-refill',
                            nameKey: 'serviceMenu.nail.options.serviceAcrylicRefill.name',
                            name: 'Acrylic',
                            nextGroups: [
                              {
                                id: 'nail-length',
                                labelKey: 'serviceMenu.nail.optionGroups.nailLength.label',
                                label: 'Nail Length',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'length-short',
                                    nameKey: 'serviceMenu.nail.options.lengthShort.name',
                                    name: 'Short / Medium',
                                    nextGroups: [
                                      {
                                        id: 'service-scope',
                                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                        label: 'Service Scope',
                                        requirement: 'required',
                                        mode: 'single',
                                        options: [
                                          {
                                            id: 'scope-mani',
                                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                            name: 'Manicure',
                                            price: 405000
                                          },
                                          {
                                            id: 'scope-pedi',
                                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                            name: 'Pedicure',
                                            price: 405000
                                          },
                                          {
                                            id: 'scope-both',
                                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                            name: 'Mani + Pedi',
                                            price: 775000
                                          }
                                        ]
                                      }
                                    ]
                                  },
                                  {
                                    id: 'length-long',
                                    nameKey: 'serviceMenu.nail.options.lengthLong.name',
                                    name: 'Long / Extra Long',
                                    nextGroups: [
                                      {
                                        id: 'service-scope',
                                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                        label: 'Service Scope',
                                        requirement: 'required',
                                        mode: 'single',
                                        options: [
                                          {
                                            id: 'scope-mani',
                                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                            name: 'Manicure',
                                            price: 515000
                                          },
                                          {
                                            id: 'scope-pedi',
                                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                            name: 'Pedicure',
                                            price: 515000
                                          },
                                          {
                                            id: 'scope-both',
                                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                            name: 'Mani + Pedi',
                                            price: 985000
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          },
                          {
                            id: 'service-hard-gel-refill',
                            nameKey: 'serviceMenu.nail.options.serviceHardGelRefill.name',
                            name: 'Hard Gel',
                            nextGroups: [
                              {
                                id: 'nail-length',
                                labelKey: 'serviceMenu.nail.optionGroups.nailLength.label',
                                label: 'Nail Length',
                                requirement: 'required',
                                mode: 'single',
                                options: [
                                  {
                                    id: 'length-short',
                                    nameKey: 'serviceMenu.nail.options.lengthShort.name',
                                    name: 'Short / Medium',
                                    nextGroups: [
                                      {
                                        id: 'service-scope',
                                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                        label: 'Service Scope',
                                        requirement: 'required',
                                        mode: 'single',
                                        options: [
                                          {
                                            id: 'scope-mani',
                                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                            name: 'Manicure',
                                            price: 515000
                                          },
                                          {
                                            id: 'scope-pedi',
                                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                            name: 'Pedicure',
                                            price: 515000
                                          },
                                          {
                                            id: 'scope-both',
                                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                            name: 'Mani + Pedi',
                                            price: 985000
                                          }
                                        ]
                                      }
                                    ]
                                  },
                                  {
                                    id: 'length-long',
                                    nameKey: 'serviceMenu.nail.options.lengthLong.name',
                                    name: 'Long / Extra Long',
                                    nextGroups: [
                                      {
                                        id: 'service-scope',
                                        labelKey: 'serviceMenu.nail.optionGroups.serviceScope.label',
                                        label: 'Service Scope',
                                        requirement: 'required',
                                        mode: 'single',
                                        options: [
                                          {
                                            id: 'scope-mani',
                                            nameKey: 'serviceMenu.nail.options.scopeMani.name',
                                            name: 'Manicure',
                                            price: 635000
                                          },
                                          {
                                            id: 'scope-pedi',
                                            nameKey: 'serviceMenu.nail.options.scopePedi.name',
                                            name: 'Pedicure',
                                            price: 635000
                                          },
                                          {
                                            id: 'scope-both',
                                            nameKey: 'serviceMenu.nail.options.scopeBoth.name',
                                            name: 'Mani + Pedi',
                                            price: 1215000
                                          }
                                        ]
                                      }
                                    ]
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: 'Hand & Foot Spa Addons',
        labelKey: 'serviceMenu.nail.categories.handFootSpaAddons.label',
        label: 'Hand & Foot Spa Addons',
        requirement: 'optional',
        mode: 'multiple', // [M] multiple add-ons can be selected
        items: [
          {
            id: 'hand-mask-prive',
            sku: 'HFA01',
            nameKey: 'serviceMenu.nail.items.handMaskPrive.name',
            name: 'Privé™ Nourishing Hand Mask',
            descriptionKey: 'serviceMenu.nail.items.handMaskPrive.desc',
            description: 'Hand Mask (20 mins) + Hand Massage (10 mins)',
            durationKey: 'serviceMenu.common.duration.30m',
            duration: '30 mins',
            price: 265000
          },
          {
            id: 'foot-mask-prive',
            sku: 'HFA02',
            nameKey: 'serviceMenu.nail.items.footMaskPrive.name',
            name: 'Privé™ Nourishing Foot Mask',
            descriptionKey: 'serviceMenu.nail.items.footMaskPrive.desc',
            description: 'Foot Mask (20 mins) + Foot Massage (10 mins)',
            durationKey: 'serviceMenu.common.duration.30m',
            duration: '30 mins',
            price: 295000
          },
          {
            id: 'heel-care-prive',
            sku: 'HFA03',
            nameKey: 'serviceMenu.nail.items.heelCarePrive.name',
            name: 'Privé™ Heel Therapy',
            descriptionKey: 'serviceMenu.nail.items.heelCarePrive.desc',
            description: 'Softening Gel + Deep Cleanse & Callus Removal + Treatment Cream',
            price: 295000
          },
          {
            id: 'arm-hand-care-prive',
            sku: 'HFA04',
            nameKey: 'serviceMenu.nail.items.armHandCarePrive.name',
            name: 'Privé™ Hand & Arm Therapy',
            descriptionKey: 'serviceMenu.nail.items.armHandCarePrive.desc',
            description: 'Exfoliation + Activation & Softening Mask + Moisturizing Lotion & Massage (10 mins)',
            price: 315000
          },
          {
            id: 'foot-care-prive',
            sku: 'HFA05',
            nameKey: 'serviceMenu.nail.items.footCarePrive.name',
            name: 'Privé™ Foot & Leg Care',
            descriptionKey: 'serviceMenu.nail.items.footCarePrive.desc',
            description: 'Cleanse + Foot Exfoliation + Foot Sock Mask + Moisturizing Lotion',
            price: 335000
          },
          {
            id: 'hand-care-loccitane',
            sku: 'HFA06',
            nameKey: 'serviceMenu.nail.items.handCareLoccitane.name',
            name: "Luxurious L'Occitane Almond Hand Spa",
            descriptionKey: 'serviceMenu.nail.items.handCareLoccitane.desc',
            description: 'Cleansing Oil + Exfoliation + Intensive Mask + Nourishing Oil + Hand & Nail Cream',
            price: 355000
          }
        ]
      }
    ]
  },
  lash: {
    tabId: 'lash',
    labelKey: 'serviceMenu.lash.tabLabel',
    label: 'Lash & Brow',
    categories: [
      {
        id: 'lash-packages',
        type: 'package',
        labelKey: 'serviceMenu.packages.categories.lashPackages.label',
        label: 'Lash & Brow Packages',
        requirement: 'optional',
        mode: 'single',
        bundle: 'fixed',
        items: [
          {
            id: 'package-lash-botox',
            sku: 'LP01',
            nameKey: 'serviceMenu.packages.items.packageLashBotox.name',
            name: 'Lash Botox ',
            descriptionKey: 'serviceMenu.packages.items.packageLashBotox.desc',
            description: 'Lash Lift, Lash Tint',
            price: 690000
          },
          {
            id: 'package-brow-reshape',
            sku: 'BP01',
            nameKey: 'serviceMenu.packages.items.packageBrowReshape.name',
            name: 'Brow Reshape Combo',
            descriptionKey: 'serviceMenu.packages.items.packageBrowReshape.desc',
            description: 'Brow Lamination, Brow Tint, Brow Wax, Jelly Mask',
            price: 940000
          },
          {
            id: 'package-lash-brow-reform',
            sku: 'LBP01',
            nameKey: 'serviceMenu.packages.items.packageLashBrowReform.name',
            name: 'Lash & Brow Reform Combo',
            descriptionKey: 'serviceMenu.packages.items.packageLashBrowReform.desc',
            description: 'Lash Lift, Lash Tint, Brow Lamination, Brow Wax',
            price: 1390000
          }
        ]
      },
      {
        id: 'lash-services',
        labelKey: 'serviceMenu.lash.categories.lashServices.label',
        label: 'Lash Services',
        requirement: 'optional',
        mode: 'multiple',
        items: [
          {
            id: 'lash-extensions',
            sku: 'LS01',
            nameKey: 'serviceMenu.lash.items.lashExtensions.name',
            name: 'Lash Extensions',
            descriptionKey: 'serviceMenu.lash.items.lashExtensions.desc',
            description: 'Professional lash extension services with various styles',
            mutuallyExclusiveItems: ['lash-lift'], // Không thể chọn cùng với Lash Lift
            optionGroups: [
              {
                id: 'extension-type',
                labelKey: 'serviceMenu.lash.optionGroups.extensionType.label',
                label: 'Extension Type',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'lash-classic',
                    nameKey: 'serviceMenu.lash.options.lashClassic.name',
                    name: 'Classic',
                    nextGroups: [
                      {
                        id: 'set-type',
                        labelKey: 'serviceMenu.lash.optionGroups.setType.label',
                        label: 'Set Type',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'set-full',
                            nameKey: 'serviceMenu.lash.options.setFull.name',
                            name: 'Full Set',
                            price: 560000
                          },
                          {
                            id: 'set-refill',
                            nameKey: 'serviceMenu.lash.options.setRefill.name',
                            name: 'Refill',
                            price: 355000
                          }
                        ]
                      }
                    ]
                  },
                  {
                    id: 'lash-premium-2d',
                    nameKey: 'serviceMenu.lash.options.lashPremium2d.name',
                    name: 'Premium 2D',
                    nextGroups: [
                      {
                        id: 'set-type',
                        labelKey: 'serviceMenu.lash.optionGroups.setType.label',
                        label: 'Set Type',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'set-full',
                            nameKey: 'serviceMenu.lash.options.setFull.name',
                            name: 'Full Set',
                            price: 615000
                          },
                          {
                            id: 'set-refill',
                            nameKey: 'serviceMenu.lash.options.setRefill.name',
                            name: 'Refill',
                            price: 385000
                          }
                        ]
                      }
                    ]
                  },
                  {
                    id: 'lash-3-4d',
                    nameKey: 'serviceMenu.lash.options.lash34d.name',
                    name: '3–4D Volume',
                    nextGroups: [
                      {
                        id: 'set-type',
                        labelKey: 'serviceMenu.lash.optionGroups.setType.label',
                        label: 'Set Type',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'set-full',
                            nameKey: 'serviceMenu.lash.options.setFull.name',
                            name: 'Full Set',
                            price: 745000
                          },
                          {
                            id: 'set-refill',
                            nameKey: 'serviceMenu.lash.options.setRefill.name',
                            name: 'Refill',
                            price: 465000
                          }
                        ]
                      }
                    ]
                  },
                  {
                    id: 'lash-5-6d',
                    nameKey: 'serviceMenu.lash.options.lash56d.name',
                    name: '5–6D Volume',
                    nextGroups: [
                      {
                        id: 'set-type',
                        labelKey: 'serviceMenu.lash.optionGroups.setType.label',
                        label: 'Set Type',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'set-full',
                            nameKey: 'serviceMenu.lash.options.setFull.name',
                            name: 'Full Set',
                            price: 830000
                          },
                          {
                            id: 'set-refill',
                            nameKey: 'serviceMenu.lash.options.setRefill.name',
                            name: 'Refill',
                            price: 465000
                          }
                        ]
                      }
                    ]
                  },

                  {
                    id: 'lash-hybrid',
                    nameKey: 'serviceMenu.lash.options.lashHybrid.name',
                    name: 'Hybrid / Soft Glam / Anime',
                    nextGroups: [
                      {
                        id: 'set-type',
                        labelKey: 'serviceMenu.lash.optionGroups.setType.label',
                        label: 'Set Type',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'set-full',
                            nameKey: 'serviceMenu.lash.options.setFull.name',
                            name: 'Full Set',
                            price: 745000
                          },
                          {
                            id: 'set-refill',
                            nameKey: 'serviceMenu.lash.options.setRefill.name',
                            name: 'Refill',
                            price: 465000
                          }
                        ]
                      }
                    ]
                  },
                  {
                    id: 'lash-kimk',
                    nameKey: 'serviceMenu.lash.options.lashKimk.name',
                    name: 'Kim K / Spike Diva',
                    nextGroups: [
                      {
                        id: 'set-type',
                        labelKey: 'serviceMenu.lash.optionGroups.setType.label',
                        label: 'Set Type',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'set-full',
                            nameKey: 'serviceMenu.lash.options.setFull.name',
                            name: 'Full Set',
                            price: 830000
                          },
                          {
                            id: 'set-refill',
                            nameKey: 'serviceMenu.lash.options.setRefill.name',
                            name: 'Refill',
                            price: 465000
                          }
                        ]
                      }
                    ]
                  },
                  {
                    id: 'lash-mega',
                    nameKey: 'serviceMenu.lash.options.lashMega.name',
                    name: 'Mega Volume (8–12D)',
                    nextGroups: [
                      {
                        id: 'set-type',
                        labelKey: 'serviceMenu.lash.optionGroups.setType.label',
                        label: 'Set Type',
                        requirement: 'required',
                        mode: 'single',
                        options: [
                          {
                            id: 'set-full',
                            nameKey: 'serviceMenu.lash.options.setFull.name',
                            name: 'Full Set',
                            price: 1110000
                          },
                          {
                            id: 'set-refill',
                            nameKey: 'serviceMenu.lash.options.setRefill.name',
                            name: 'Refill',
                            price: 605000
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            id: 'lash-removal',
            sku: 'LS02',
            nameKey: 'serviceMenu.lash.items.lashRemoval.name',
            name: 'Lash Removal',
            descriptionKey: 'serviceMenu.lash.items.lashRemoval.desc',
            description: 'Choose Between Upper or Lower Lash Removal Services for a Clean and Hassle-Free Transition.',
            price: 125000
          },
          {
            id: 'color-lash',
            sku: 'LS02',
            nameKey: 'serviceMenu.lash.items.colorLash.name',
            name: 'Color Lash',
            descriptionKey: 'serviceMenu.lash.items.colorLash.desc',
            description: 'Variety of colored lash extensions to make eyes stand out',
            price: 175000
          },
          {
            id: 'lower-lash',
            sku: 'LS03',
            nameKey: 'serviceMenu.lash.items.lowerLash.name',
            name: 'Lower Lashes',
            descriptionKey: 'serviceMenu.lash.items.lowerLash.desc',
            description: 'Enhanced lower lashes for a more defined and sharp look',
            price: 205000
          },
          {
            id: 'lash-tint',
            sku: 'LS04',
            nameKey: 'serviceMenu.lash.items.lashTint.name',
            name: 'Lash Tint',
            descriptionKey: 'serviceMenu.lash.items.lashTint.desc',
            description: 'Apply a layer of long-lasting/natural dye color to lashes',
            price: 255000
          },
          {
            id: 'lash-lift',
            sku: 'LS05',
            nameKey: 'serviceMenu.lash.items.lashLift.name',
            name: 'Lash Lift',
            descriptionKey: 'serviceMenu.lash.items.lashLift.desc',
            description: 'Natural lashes are curled and lifted, making them appear longer and eyes more open',
            price: 445000,
            mutuallyExclusiveItems: ['lash-extensions'] // Không thể chọn cùng với Lash Extensions
          }
        ]
      },

      // ---------------------------
      // Brow Services
      // ---------------------------
      {
        id: 'brow-services',
        labelKey: 'serviceMenu.lash.categories.browServices.label',
        label: 'Brow Services',
        requirement: 'optional',
        mode: 'multiple',
        items: [
          {
            id: 'brow-wax',
            sku: 'BS01',
            nameKey: 'serviceMenu.lash.items.browWax.name',
            name: 'Brow Wax',
            price: 175000
          },
          {
            id: 'brow-tint',
            sku: 'BS02',
            nameKey: 'serviceMenu.lash.items.browTint.name',
            name: 'Brow Tint',
            descriptionKey: 'serviceMenu.lash.items.browTint.desc',
            description: 'Apply a layer of long-lasting/natural dye color to brows',
            price: 255000
          },
          {
            id: 'brow-lamination',
            sku: 'BS03',
            nameKey: 'serviceMenu.lash.items.browLamination.name',
            name: 'Brow Lamination',
            descriptionKey: 'serviceMenu.lash.items.browLamination.desc',
            description: 'Fuller-looking brows that stay in place when brushed into shape, lasting around 6 weeks',
            price: 525000
          }
        ]
      }
    ]
  },
  massage: {
    tabId: 'massage',
    labelKey: 'serviceMenu.massage.tabLabel',
    label: 'Massage Services',
    categories: [
      {
        id: 'hand-foot-massage',
        labelKey: 'serviceMenu.massage.categories.handFootMassage.label',
        label: 'Hand / Foot Massage',
        requirement: 'optional',
        mode: 'multiple',
        items: [
          {
            id: 'massage-prive-hand',
            sku: 'MH01',
            nameKey: 'serviceMenu.massage.items.massagePriveHand.name',
            name: 'Privé Hand Massage',
            descriptionKey: 'serviceMenu.massage.items.massagePriveHand.desc',
            description:
              'A gentle hand massage therapy that provides deep relaxation, restores energy, and brings a soft, refreshed feeling',
            optionGroups: [
              {
                id: 'duration',
                labelKey: 'serviceMenu.massage.optionGroups.duration.label',
                label: 'Duration',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'duration-15',
                    nameKey: 'serviceMenu.common.duration.15m',
                    name: '15 mins',
                    price: 175000
                  },
                  {
                    id: 'duration-30',
                    nameKey: 'serviceMenu.common.duration.30m',
                    name: '30 mins',
                    price: 325000
                  },
                  {
                    id: 'duration-60',
                    nameKey: 'serviceMenu.common.duration.60m',
                    name: '60 mins',
                    price: 525000
                  }
                ]
              }
            ]
          },
          {
            id: 'massage-prive-foot',
            sku: 'MF01',
            nameKey: 'serviceMenu.massage.items.massagePriveFoot.name',
            name: 'Privé™ Foot Massage',
            descriptionKey: 'serviceMenu.massage.items.massagePriveFoot.desc',
            description:
              'A gentle foot massage therapy that provides deep relaxation, restores energy, and brings a soft, refreshed feeling',
            optionGroups: [
              {
                id: 'duration',
                labelKey: 'serviceMenu.massage.optionGroups.duration.label',
                label: 'Duration',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'duration-15',
                    nameKey: 'serviceMenu.common.duration.15m',
                    name: '15 mins',
                    price: 175000
                  },
                  {
                    id: 'duration-30',
                    nameKey: 'serviceMenu.common.duration.30m',
                    name: '30 mins',
                    price: 325000
                  },
                  {
                    id: 'duration-60',
                    nameKey: 'serviceMenu.common.duration.60m',
                    name: '60 mins',
                    price: 525000
                  },
                  {
                    id: 'duration-60-hotstone',
                    nameKey: 'serviceMenu.massage.options.duration60Hotstone.name',
                    name: '60 mins (Includes 15 mins Hot Stone)',
                    price: 680000
                  }
                ]
              }
            ]
          }
        ]
      },

      // ---------------------------
      // Upper Body Massage
      // ---------------------------
      {
        id: 'upper-body-massage',
        labelKey: 'serviceMenu.massage.categories.upperBodyMassage.label',
        label: 'Upper Body Massage',
        requirement: 'optional',
        mode: 'single',
        items: [
          {
            id: 'massage-facial',
            sku: 'MUB01',
            nameKey: 'serviceMenu.massage.items.massageFacial.name',
            name: 'Privé™ Relaxing Facial Massage',
            descriptionKey: 'serviceMenu.massage.items.massageFacial.desc',
            description:
              'A refined facial massage therapy that helps relieve tension, enhances radiance, and regenerates a youthful appearance for the skin',
            durationKey: 'serviceMenu.common.duration.30m',
            duration: '30 mins',
            price: 315000
          },
          {
            id: 'massage-neck-back',
            sku: 'MUB02',
            nameKey: 'serviceMenu.massage.items.massageNeckBack.name',
            name: 'Privé™ Neck & Back Massage',
            descriptionKey: 'serviceMenu.massage.items.massageNeckBack.desc',
            description:
              'An intensive back and neck massage therapy that helps relieve pressure, deeply relax muscles, bringing the body back to a balanced and vital state',
            durationKey: 'serviceMenu.common.duration.30m',
            duration: '30 mins',
            price: 355000
          }
        ]
      },

      // ---------------------------
      // Body Massage [V]
      // ---------------------------
      {
        id: 'body-massage',
        labelKey: 'serviceMenu.massage.categories.bodyMassage.label',
        label: 'Body Massage',
        requirement: 'optional',
        mode: 'single', // [V]
        items: [
          {
            id: 'massage-coconut',
            sku: 'MB01',
            nameKey: 'serviceMenu.massage.items.massageCoconut.name',
            name: 'Privé™ Coconut Bliss',
            descriptionKey: 'serviceMenu.massage.items.massageCoconut.desc',
            description: 'Coconut oil body massage',
            optionGroups: [
              {
                id: 'duration',
                labelKey: 'serviceMenu.massage.optionGroups.duration.label',
                label: 'Duration',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'duration-60',
                    nameKey: 'serviceMenu.common.duration.60m',
                    name: '60 mins',
                    price: 545000
                  },
                  {
                    id: 'duration-90',
                    nameKey: 'serviceMenu.common.duration.90m',
                    name: '90 mins',
                    price: 715000
                  },
                  {
                    id: 'duration-120',
                    nameKey: 'serviceMenu.common.duration.120m',
                    name: '120 mins',
                    price: 935000
                  }
                ]
              }
            ]
          },
          {
            id: 'massage-aroma',
            sku: 'MB02',
            nameKey: 'serviceMenu.massage.items.massageAroma.name',
            name: 'Privé™ Aroma Recharge',
            descriptionKey: 'serviceMenu.massage.items.massageAroma.desc',
            description: 'Therapeutic fragrance massage',
            optionGroups: [
              {
                id: 'duration',
                labelKey: 'serviceMenu.massage.optionGroups.duration.label',
                label: 'Duration',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'duration-60',
                    nameKey: 'serviceMenu.common.duration.60m',
                    name: '60 mins',
                    price: 595000
                  },
                  {
                    id: 'duration-90',
                    nameKey: 'serviceMenu.common.duration.90m',
                    name: '90 mins',
                    price: 765000
                  },
                  {
                    id: 'duration-120',
                    nameKey: 'serviceMenu.common.duration.120m',
                    name: '120 mins',
                    price: 995000
                  }
                ]
              }
            ]
          },
          {
            id: 'massage-athlete',
            sku: 'MB03',
            nameKey: 'serviceMenu.massage.items.massageAthlete.name',
            name: 'Privé™ Athlete Recovery',
            descriptionKey: 'serviceMenu.massage.items.massageAthlete.desc',
            description: 'Sport relief massage tailored for athletes',
            durationKey: 'serviceMenu.common.duration.60m',
            duration: '60 mins',
            price: 885000
          },
          {
            id: 'massage-signature',
            sku: 'MB04',
            nameKey: 'serviceMenu.massage.items.massageSignature.name',
            name: 'Privé™ Signature Spa',
            descriptionKey: 'serviceMenu.massage.items.massageSignature.desc',
            description:
              'A 120-minute signature experience following a carefully curated treatment sequence to promote deep relaxation, relieve muscle tension, and restore overall balance',
            durationKey: 'serviceMenu.common.duration.120m',
            duration: '120 mins',
            price: 1355000
          }
        ]
      }
    ]
  },
  spa: {
    tabId: 'spa',
    labelKey: 'serviceMenu.spa.tabLabel',
    label: 'Spa Services',
    noteKey: 'serviceMenu.spa.tabNote',
    note: 'Davines hair care products contains gentle formulations, suitable for all hair types. Addressing various hair concerns such as dryness, breakage, or dandruff, Davines products excel in providing deep nourishment and effective treatment, delivering quick and comprehensive results. Davines hair care products are free from harmful ingredients such as sulfates and parabens.',
    categories: [
      {
        id: 'hair-wash',
        labelKey: 'serviceMenu.spa.categories.hairWash.label',
        label: 'Essential Hair Wash',
        requirement: 'optional',
        mode: 'single',
        items: [
          {
            id: 'hair-essential',
            sku: 'HaS01',
            nameKey: 'serviceMenu.spa.items.hairEssential.name',
            name: 'Essential Hair Wash',
            durationKey: 'serviceMenu.common.duration.30m',
            duration: '30 mins',
            descriptionKey: 'serviceMenu.spa.items.hairEssential.desc',
            description:
              'A refreshing Hair Wash using the Davines Essential line, including a relaxing head or hand massage (10 mins).',
            detailedInfo: [
              {
                titleKey: 'serviceMenu.spa.detailedSections.products',
                contentKey: 'serviceMenu.spa.items.hairEssential.details.products'
              }
            ],
            optionGroups: [
              {
                id: 'hair-length',
                labelKey: 'serviceMenu.spa.optionGroups.hairLength.label',
                label: 'Hair Length',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'length-short',
                    nameKey: 'serviceMenu.spa.options.lengthShort.name',
                    name: 'Short / Medium',
                    price: 255000
                  },
                  {
                    id: 'long-below-shoulder',
                    nameKey: 'serviceMenu.spa.options.longBelowShoulder.name',
                    name: 'Long / Below Shoulder',
                    price: 355000
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: 'head-spa',
        labelKey: 'serviceMenu.spa.categories.headSpa.label',
        label: 'Signature Head Spa',
        requirement: 'optional',
        mode: 'single',
        items: [
          {
            id: 'hair-signature',
            sku: 'HeS01',
            nameKey: 'serviceMenu.spa.items.hairSignature.name',
            name: 'Signature Head Spa',
            durationKey: 'serviceMenu.common.duration.60m',
            duration: '60 mins',
            descriptionKey: 'serviceMenu.spa.items.hairSignature.desc',
            description:
              'A refreshing Head Spa using the Treatment line, with a customized treatment selected for each hair type. Includes a shoulder and neck massage (20 mins) & a hand massage (10 mins).',
            detailedInfo: [
              {
                titleKey: 'serviceMenu.spa.detailedSections.products',
                contentKey: 'serviceMenu.spa.items.hairSignature.details.products'
              }
            ],
            optionGroups: [
              {
                id: 'hair-length',
                labelKey: 'serviceMenu.spa.optionGroups.hairLength.label',
                label: 'Hair Length',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'length-short',
                    nameKey: 'serviceMenu.spa.options.lengthShort.name',
                    name: 'Short / Medium',
                    price: 555000
                  },
                  {
                    id: 'long-below-shoulder',
                    nameKey: 'serviceMenu.spa.options.longBelowShoulder.name',
                    name: 'Long / Below Shoulder',
                    price: 755000
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: 'head-spa-addons',
        labelKey: 'serviceMenu.spa.categories.headSpaAddons.label',
        label: 'Head Spa Add-ons',
        requirement: 'optional',
        mode: 'multiple',
        items: [
          {
            id: 'addon-radiant-cleansing',
            sku: 'HSA01',
            nameKey: 'serviceMenu.spa.items.addonRadiantCleansing.name',
            name: 'Radiant Cleansing',
            descriptionKey: 'serviceMenu.spa.items.addonRadiantCleansing.desc',
            description: 'Makeup removal and facial cleansing.',
            durationKey: 'serviceMenu.common.duration.15m',
            duration: '15 mins',
            price: 155000
          },
          {
            id: 'addon-natural-glow',
            sku: 'HSA02',
            nameKey: 'serviceMenu.spa.items.addonNaturalGlow.name',
            name: 'Natural Glow',
            descriptionKey: 'serviceMenu.spa.items.addonNaturalGlow.desc',
            description: 'Makeup removal, facial cleansing, face massage and mask application.',
            durationKey: 'serviceMenu.common.duration.30m',
            duration: '30 mins',
            price: 285000
          }
        ]
      }

      // ---------------------------
      // Spa Add-ons [M]
      // ---------------------------
    ]
  },
  facial: {
    tabId: 'facial',
    labelKey: 'serviceMenu.facial.tabLabel',
    label: 'Facial Treatments',
    categories: [
      // ---------------------------
      // Comfort Zone Facials [V] + Duration [V]
      // ---------------------------
      {
        id: 'signature-facials',
        labelKey: 'serviceMenu.packages.categories.signatureFacials.label',
        label: 'Signature Facials',
        requirement: 'optional',
        mode: 'multiple',
        items: [
          {
            id: 'facial-yoga',
            sku: 'FS01',
            nameKey: 'serviceMenu.packages.items.facialYoga.name',
            name: 'Yoga Facial',
            durationKey: 'serviceMenu.common.duration.60m',
            duration: '60 mins',
            price: 1680000,
            detailedInfo: [
              {
                titleKey: 'serviceMenu.packages.detailedSections.treatment',
                contentKey: 'serviceMenu.packages.items.facialYoga.details.treatment'
              },
              {
                titleKey: 'serviceMenu.packages.detailedSections.effects',
                contentKey: 'serviceMenu.packages.items.facialYoga.details.effects'
              }
            ]
          },
          {
            id: 'facial-aqua',
            sku: 'FS02',
            nameKey: 'serviceMenu.packages.items.facialAqua.name',
            name: 'Aqua Peel',
            durationKey: 'serviceMenu.common.duration.75m',
            duration: '75 mins',
            price: 1355000,
            detailedInfo: [
              {
                titleKey: 'serviceMenu.packages.detailedSections.overview',
                contentKey: 'serviceMenu.packages.items.facialAqua.details.overview'
              },
              {
                titleKey: 'serviceMenu.packages.detailedSections.suitableFor',
                contentKey: 'serviceMenu.packages.items.facialAqua.details.suitableFor'
              },
              {
                titleKey: 'serviceMenu.packages.detailedSections.benefits',
                contentKey: 'serviceMenu.packages.items.facialAqua.details.benefits'
              },
              {
                titleKey: 'serviceMenu.packages.detailedSections.results',
                contentKey: 'serviceMenu.packages.items.facialAqua.details.results'
              }
            ]
          }
        ]
      },
      {
        id: 'comfort-zone-facials',
        labelKey: 'serviceMenu.facial.categories.comfortZoneFacials.label',
        label: 'Comfort Zone Facials',
        requirement: 'optional',
        mode: 'single', // [V]
        items: [
          {
            id: 'facial-remedy',
            sku: 'FCZ01',
            nameKey: 'serviceMenu.facial.items.facialRemedy.name',
            name: 'Remedy Soothing',
            descriptionKey: 'serviceMenu.facial.items.facialRemedy.desc',
            optionGroups: [
              {
                id: 'duration',
                labelKey: 'serviceMenu.facial.optionGroups.duration.label',
                label: 'Duration',
                requirement: 'required', // [M]
                mode: 'single', // [V]
                options: [
                  {
                    id: 'duration-basic',
                    nameKey: 'serviceMenu.facial.options.durationBasic60.name',
                    name: 'Basic – 60 mins',
                    price: 635000
                  },
                  {
                    id: 'duration-pro',
                    nameKey: 'serviceMenu.facial.options.durationPro90.name',
                    name: 'Pro – 90 mins',
                    price: 1515000
                  }
                ]
              }
            ]
          },
          {
            id: 'facial-recover',
            sku: 'FCZ02',
            nameKey: 'serviceMenu.facial.items.facialRecover.name',
            name: 'Recover Touch',
            descriptionKey: 'serviceMenu.facial.items.facialRecover.desc',
            optionGroups: [
              {
                id: 'duration',
                labelKey: 'serviceMenu.facial.optionGroups.duration.label',
                label: 'Duration',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'duration-basic',
                    nameKey: 'serviceMenu.facial.options.durationBasic60.name',
                    name: 'Basic – 60 mins',
                    price: 675000
                  },
                  {
                    id: 'duration-pro',
                    nameKey: 'serviceMenu.facial.options.durationPro90.name',
                    name: 'Pro – 90 mins',
                    price: 1785000
                  }
                ]
              }
            ]
          },
          {
            id: 'facial-pureness',
            sku: 'FCZ03',
            nameKey: 'serviceMenu.facial.items.facialPureness.name',
            name: 'Active Pureness',
            descriptionKey: 'serviceMenu.facial.items.facialPureness.desc',
            optionGroups: [
              {
                id: 'duration',
                labelKey: 'serviceMenu.facial.optionGroups.duration.label',
                label: 'Duration',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'duration-basic',
                    nameKey: 'serviceMenu.facial.options.durationBasic60.name',
                    name: 'Basic – 60 mins',
                    price: 815000
                  },
                  {
                    id: 'duration-pro',
                    nameKey: 'serviceMenu.facial.options.durationPro90.name',
                    name: 'Pro – 90 mins',
                    price: 1555000
                  }
                ]
              }
            ]
          },
          {
            id: 'facial-hydramemory',
            sku: 'FCZ04',
            nameKey: 'serviceMenu.facial.items.facialHydramemory.name',
            name: 'Hydramemory',
            descriptionKey: 'serviceMenu.facial.items.facialHydramemory.desc',
            optionGroups: [
              {
                id: 'duration',
                labelKey: 'serviceMenu.facial.optionGroups.duration.label',
                label: 'Duration',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'duration-basic',
                    nameKey: 'serviceMenu.facial.options.durationBasic60.name',
                    name: 'Basic – 60 mins',
                    price: 995000
                  },
                  {
                    id: 'duration-pro',
                    nameKey: 'serviceMenu.facial.options.durationPro90.name',
                    name: 'Pro – 90 mins',
                    price: 1415000
                  }
                ]
              }
            ]
          },
          {
            id: 'facial-sublime',
            sku: 'FCZ05',
            nameKey: 'serviceMenu.facial.items.facialSublime.name',
            name: 'Sublime Skin Pro',
            durationKey: 'serviceMenu.common.duration.90m',
            duration: '90 mins',
            descriptionKey: 'serviceMenu.facial.items.facialSublime.desc',
            price: 2555000
          }
        ]
      }
    ]
  },
  waxing: {
    tabId: 'waxing',
    labelKey: 'serviceMenu.waxing.tabLabel',
    label: 'Waxing & Hair Removal',
    categories: [
      // ---------------------------
      // Waxing (Women)
      // ---------------------------
      {
        id: 'waxing-women',
        labelKey: 'serviceMenu.waxing.categories.waxingWomen.label',
        label: 'Waxing (Women)',
        noteKey: 'serviceMenu.waxing.categories.waxingWomen.note',
        note: 'Hard wax and GIGI soft wax available',
        requirement: 'optional',
        mode: 'multiple',
        items: [
          {
            id: 'wax-face-women',
            sku: 'WW01',
            nameKey: 'serviceMenu.waxing.items.waxFace.name',
            name: 'Face',
            optionGroups: [
              {
                id: 'area',
                labelKey: 'serviceMenu.waxing.optionGroups.area.label',
                label: 'Area',
                requirement: 'required',
                mode: 'multiple',
                options: [
                  {
                    id: 'area-lip',
                    nameKey: 'serviceMenu.waxing.options.areaLip.name',
                    name: 'Lip',
                    price: 145000
                  },
                  {
                    id: 'area-hairline',
                    nameKey: 'serviceMenu.waxing.options.areaHairline.name',
                    name: 'Face Hairline',
                    price: 155000
                  },
                  {
                    id: 'area-chin',
                    nameKey: 'serviceMenu.waxing.options.areaChin.name',
                    name: 'Under Chin',
                    price: 165000
                  },
                  {
                    id: 'area-lip-chin',
                    nameKey: 'serviceMenu.waxing.options.areaLipChin.name',
                    name: 'Full Lip Chin',
                    price: 235000
                  },
                  {
                    id: 'area-eyebrow',
                    nameKey: 'serviceMenu.waxing.options.areaEyebrow.name',
                    name: 'Eyebrow',
                    price: 175000
                  },
                  {
                    id: 'area-neck',
                    nameKey: 'serviceMenu.waxing.options.areaNeck.name',
                    name: 'Neck',
                    price: 225000
                  }
                ]
              }
            ]
          },
          {
            id: 'wax-arms-women',
            sku: 'WW03',
            nameKey: 'serviceMenu.waxing.items.waxArms.name',
            name: 'Arms',
            optionGroups: [
              {
                id: 'area',
                labelKey: 'serviceMenu.waxing.optionGroups.area.label',
                label: 'Area',
                requirement: 'required',
                mode: 'multiple',
                options: [
                  {
                    id: 'area-underarms',
                    nameKey: 'serviceMenu.waxing.options.areaUnderarms.name',
                    name: 'Underarms',
                    price: 165000
                  },
                  {
                    id: 'area-half',
                    nameKey: 'serviceMenu.waxing.options.areaHalfArms.name',
                    name: 'Half Arms',
                    price: 185000,
                    mutuallyExclusive: ['area-full']
                  },
                  {
                    id: 'area-full',
                    nameKey: 'serviceMenu.waxing.options.areaFullArms.name',
                    name: 'Full Arms',
                    price: 315000,
                    mutuallyExclusive: ['area-half']
                  }
                ]
              }
            ]
          },
          {
            id: 'wax-legs-women',
            sku: 'WW04',
            nameKey: 'serviceMenu.waxing.items.waxLegs.name',
            name: 'Legs',
            optionGroups: [
              {
                id: 'coverage',
                labelKey: 'serviceMenu.waxing.optionGroups.coverage.label',
                label: 'Coverage',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'coverage-half',
                    nameKey: 'serviceMenu.waxing.options.coverageHalf.name',
                    name: 'Half',
                    price: 375000
                  },
                  {
                    id: 'coverage-full',
                    nameKey: 'serviceMenu.waxing.options.coverageFull.name',
                    name: 'Full',
                    price: 565000
                  }
                ]
              }
            ]
          },
          {
            id: 'wax-bikini-women',
            sku: 'WW05',
            nameKey: 'serviceMenu.waxing.items.waxBikini.name',
            name: 'Bikini',
            optionGroups: [
              {
                id: 'coverage',
                labelKey: 'serviceMenu.waxing.optionGroups.coverage.label',
                label: 'Coverage',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'coverage-half',
                    nameKey: 'serviceMenu.waxing.options.coverageHalf.name',
                    name: 'Half',
                    price: 545000
                  },
                  {
                    id: 'coverage-full',
                    nameKey: 'serviceMenu.waxing.options.coverageFull.name',
                    name: 'Full',
                    price: 645000
                  }
                ]
              }
            ]
          },
          {
            id: 'wax-back-women',
            sku: 'WW06',
            nameKey: 'serviceMenu.waxing.items.waxBack.name',
            name: 'Back',
            optionGroups: [
              {
                id: 'coverage',
                labelKey: 'serviceMenu.waxing.optionGroups.coverage.label',
                label: 'Coverage',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'coverage-half',
                    nameKey: 'serviceMenu.waxing.options.coverageHalf.name',
                    name: 'Half',
                    price: 485000
                  },
                  {
                    id: 'coverage-full',
                    nameKey: 'serviceMenu.waxing.options.coverageFull.name',
                    name: 'Full',
                    price: 785000
                  }
                ]
              }
            ]
          },
          {
            id: 'wax-belly-women',
            sku: 'WW07',
            nameKey: 'serviceMenu.waxing.items.waxBelly.name',
            name: 'Belly',
            price: 755000
          }
        ]
      },
      // ---------------------------
      // Waxing (Men)
      // ---------------------------
      {
        id: 'waxing-men',
        labelKey: 'serviceMenu.waxing.categories.waxingMen.label',
        label: 'Waxing (Men)',
        noteKey: 'serviceMenu.waxing.categories.waxingMen.note',
        note: 'Hard wax and GIGI soft wax available',
        requirement: 'optional',
        mode: 'multiple',
        items: [
          {
            id: 'wax-face-men',
            sku: 'WM01',
            nameKey: 'serviceMenu.waxing.items.waxFace.name',
            name: 'Face',
            optionGroups: [
              {
                id: 'area',
                labelKey: 'serviceMenu.waxing.optionGroups.area.label',
                label: 'Area',
                requirement: 'required',
                mode: 'multiple',
                options: [
                  {
                    id: 'area-lip',
                    nameKey: 'serviceMenu.waxing.options.areaLip.name',
                    name: 'Lip',
                    price: 218000
                  },
                  {
                    id: 'area-hairline',
                    nameKey: 'serviceMenu.waxing.options.areaHairline.name',
                    name: 'Face Hairline',
                    price: 233000
                  },
                  {
                    id: 'area-chin',
                    nameKey: 'serviceMenu.waxing.options.areaChin.name',
                    name: 'Under Chin',
                    price: 248000
                  },
                  {
                    id: 'area-lip-chin',
                    nameKey: 'serviceMenu.waxing.options.areaLipChin.name',
                    name: 'Full Lip Chin',
                    price: 253000
                  },
                  {
                    id: 'area-eyebrow',
                    nameKey: 'serviceMenu.waxing.options.areaEyebrow.name',
                    name: 'Eyebrow',
                    price: 263000
                  },
                  {
                    id: 'area-neck',
                    nameKey: 'serviceMenu.waxing.options.areaNeck.name',
                    name: 'Neck',
                    price: 338000
                  }
                ]
              }
            ]
          },
          {
            id: 'wax-arms-men',
            sku: 'WM03',
            nameKey: 'serviceMenu.waxing.items.waxArms.name',
            name: 'Arms',
            optionGroups: [
              {
                id: 'area',
                labelKey: 'serviceMenu.waxing.optionGroups.area.label',
                label: 'Area',
                requirement: 'required',
                mode: 'multiple',
                options: [
                  {
                    id: 'area-underarms',
                    nameKey: 'serviceMenu.waxing.options.areaUnderarms.name',
                    name: 'Underarms',
                    price: 248000
                  },
                  {
                    id: 'area-half',
                    nameKey: 'serviceMenu.waxing.options.areaHalfArms.name',
                    name: 'Half Arms',
                    price: 278000
                  },
                  {
                    id: 'area-full',
                    nameKey: 'serviceMenu.waxing.options.areaFullArms.name',
                    name: 'Full Arms',
                    price: 473000
                  }
                ]
              }
            ]
          },
          {
            id: 'wax-legs-men',
            sku: 'WM04',
            nameKey: 'serviceMenu.waxing.items.waxLegs.name',
            name: 'Legs',
            optionGroups: [
              {
                id: 'coverage',
                labelKey: 'serviceMenu.waxing.optionGroups.coverage.label',
                label: 'Coverage',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'coverage-half',
                    nameKey: 'serviceMenu.waxing.options.coverageHalf.name',
                    name: 'Half',
                    price: 563000
                  },
                  {
                    id: 'coverage-full',
                    nameKey: 'serviceMenu.waxing.options.coverageFull.name',
                    name: 'Full',
                    price: 848000
                  }
                ]
              }
            ]
          },
          {
            id: 'wax-back-men',
            sku: 'WM05',
            nameKey: 'serviceMenu.waxing.items.waxBack.name',
            name: 'Back',
            optionGroups: [
              {
                id: 'coverage',
                labelKey: 'serviceMenu.waxing.optionGroups.coverage.label',
                label: 'Coverage',
                requirement: 'required',
                mode: 'single',
                options: [
                  {
                    id: 'coverage-half',
                    nameKey: 'serviceMenu.waxing.options.coverageHalf.name',
                    name: 'Half',
                    price: 728000
                  },
                  {
                    id: 'coverage-full',
                    nameKey: 'serviceMenu.waxing.options.coverageFull.name',
                    name: 'Full',
                    price: 1178000
                  }
                ]
              }
            ]
          },
          {
            id: 'wax-belly-men',
            sku: 'WM06',
            nameKey: 'serviceMenu.waxing.items.waxBelly.name',
            name: 'Belly',
            price: 1133000
          }
        ]
      }
    ]
  }
}
